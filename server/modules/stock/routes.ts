import type { Express } from "express";
import type pg from "pg";
import { z } from "zod";
import { auditTx, ensureOwned, HttpError, route } from "../../http/route";
import { uuid, qtyNum } from "../../http/schemas";
import { postMovement, suggestFefo, clientIdempotencyKey } from "../stock/ledger";

export function registerStockRoutes(app: Express, pool: pg.Pool) {
  // Branches and stores ------------------------------------------------------
  app.get("/api/branches", route(pool, "catalogue.read", async ({ c }) =>
    (await c.query("select id, name, active from branches order by name")).rows));
  app.get("/api/stores", route(pool, "catalogue.read", async ({ c }) =>
    (await c.query(`select id, name, kind, branch_id "branchId", active from stores where kind <> 'transit' order by name`)).rows));

  // Stock views ----------------------------------------------------------------
  app.get("/api/stock", route(pool, "catalogue.read", async ({ c, req }) => {
    const itemId = req.query.itemId ? uuid.parse(req.query.itemId) : null;
    const storeId = req.query.storeId ? uuid.parse(req.query.storeId) : null;
    return (await c.query(
      `select sb.item_id "itemId", i.code, i.generic_name "itemName", i.unit, sb.batch_id "batchId", b.batch_no "batchNo",
              to_char(b.expiry_date,'YYYY-MM-DD') "expiryDate", (b.expiry_date < today_ist()) expired,
              sb.store_id "storeId", st.name "storeName", sb.quantity::float quantity, b.unit_cost_paise::float "unitCostPaise"
         from stock_balances sb join items i on i.id = sb.item_id join batches b on b.id = sb.batch_id join stores st on st.id = sb.store_id
        where sb.quantity <> 0 and ($1::uuid is null or sb.item_id = $1) and ($2::uuid is null or sb.store_id = $2)
        order by i.generic_name, b.expiry_date limit 1000`, [itemId, storeId])).rows;
  }));

  app.get("/api/stock/suggest", route(pool, "stock.issue", async ({ c, req }) => {
    const q = z.object({ itemId: uuid, storeId: uuid, quantity: qtyNum }).parse(req.query);
    return suggestFefo(c, q.itemId, q.storeId, q.quantity);
  }));

  app.get("/api/low-stock", route(pool, "catalogue.read", async ({ c }) =>
    (await c.query(
      `select * from (
         select i.id "itemId", i.code, i.generic_name "itemName", i.unit, i.min_qty::float "minQty",
                coalesce(sum(sb.quantity),0)::float "onHand",
                greatest(i.reorder_qty, i.min_qty * 2 - coalesce(sum(sb.quantity),0))::float "suggestedReorder",
                i.default_supplier_id "supplierId"
           from items i left join stock_balances sb on sb.item_id = i.id
          where i.active group by i.id) t
       where "onHand" <= "minQty" and "minQty" > 0 order by "onHand" - "minQty", "itemName"`)).rows));

  app.get("/api/expiring", route(pool, "catalogue.read", async ({ c, req }) => {
    const days = Math.min(Math.max(Number(req.query.days ?? 90) || 90, 1), 730);
    return (await c.query(
      `select i.id "itemId", i.generic_name "itemName", b.id "batchId", b.batch_no "batchNo", to_char(b.expiry_date,'YYYY-MM-DD') "expiryDate",
              (b.expiry_date - today_ist()) "daysLeft", sum(sb.quantity)::float quantity, (b.expiry_date < today_ist()) expired
         from stock_balances sb join batches b on b.id = sb.batch_id join items i on i.id = sb.item_id
        where sb.quantity > 0 and b.expiry_date <= today_ist() + $1::int
        group by i.id, b.id order by b.expiry_date`, [days])).rows;
  }));

  // Adjustments: damage, expiry write-off, supplier return, count correction ---------
  const AdjustBody = z.object({
    type: z.enum(["damage", "expiry_writeoff", "return_to_supplier", "count_adjustment"]),
    itemId: uuid, batchId: uuid, storeId: uuid, quantity: qtyNum,
    direction: z.enum(["increase", "decrease"]).optional(), reason: z.string().trim().min(3, "A reason is required").max(300),
    override: z.boolean().optional(),
  });
  app.post("/api/stock/adjust", route(pool, "stock.adjust", async ({ c, user, req }) => {
    const b = AdjustBody.parse(req.body);
    await ensureOwned(c, "items", [b.itemId]);
    await ensureOwned(c, "batches", [b.batchId]);
    await ensureOwned(c, "stores", [b.storeId]);
    if (b.type === "count_adjustment" && !b.direction) throw new HttpError(400, "invalid", "direction: choose increase or decrease");
    const adding = b.type === "count_adjustment" && b.direction === "increase";
    if (b.override && !(user.role === "admin" || user.role === "inventory_manager")) throw new HttpError(403, "forbidden", "Your role cannot override stock limits.");
    const id = await postMovement(c, {
      tenantId: user.tenantId, type: b.type, itemId: b.itemId, batchId: b.batchId, quantity: b.quantity,
      fromStoreId: adding ? null : b.storeId, toStoreId: adding ? b.storeId : null, userId: user.userId,
      reason: b.reason, reference: `adjust:${b.type}`, idempotencyKey: clientIdempotencyKey(user.userId, req.get("idempotency-key")),
      override: b.override,
    });
    await auditTx(c, user, `stock.${b.type}`, "stock_ledger", id, { itemId: b.itemId, batchId: b.batchId, quantity: b.quantity }, b.reason);
    return { ledgerId: id };
  }, 201));

  app.get("/api/ledger", route(pool, "audit.read", async ({ c, req }) => {
    const itemId = req.query.itemId ? uuid.parse(req.query.itemId) : null;
    const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
    return (await c.query(
      `select l.id, l.at, l.type, l.quantity::float quantity, i.generic_name "itemName", b.batch_no "batchNo",
              fs.name "fromStore", ts.name "toStore", u.name "userName", l.reason, l.reference, l.override
         from stock_ledger l join items i on i.id = l.item_id join batches b on b.id = l.batch_id
         left join stores fs on fs.id = l.from_store_id left join stores ts on ts.id = l.to_store_id left join users u on u.id = l.user_id
        where ($1::uuid is null or l.item_id = $1) order by l.id desc limit $2`, [itemId, limit])).rows;
  }));
}
