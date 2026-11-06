import type { Express } from "express";
import type pg from "pg";
import { z } from "zod";
import { auditTx, ensureOwned, HttpError, notFound, route } from "../../http/route";
import { uuid } from "../../http/schemas";
import { postMovement } from "../stock/ledger";
import { can } from "../auth/permissions";

export function registerCountRoutes(app: Express, pool: pg.Pool) {
  // Stock counts ---------------------------------------------------------------------------
  const countView = async (c: pg.PoolClient, id: string) => {
    const k = (await c.query(
      `select k.id, k.status, k.store_id "storeId", s.name "storeName", k.created_at "createdAt", k.posted_at "postedAt"
         from stock_counts k join stores s on s.id = k.store_id where k.id = $1`, [id])).rows[0];
    if (!k) throw notFound("Count");
    k.lines = (await c.query(
      `select l.id, l.item_id "itemId", i.generic_name "itemName", l.batch_id "batchId", b.batch_no "batchNo",
              to_char(b.expiry_date,'YYYY-MM-DD') "expiryDate", l.system_qty::float "systemQty", l.counted_qty::float "countedQty",
              (l.counted_qty - l.system_qty)::float variance, l.reason
         from count_lines l join items i on i.id = l.item_id join batches b on b.id = l.batch_id where l.count_id = $1 order by i.generic_name, b.expiry_date`, [id])).rows;
    return k;
  };
  app.get("/api/counts", route(pool, "stock.count", async ({ c }) =>
    (await c.query(`select k.id, k.status, s.name "storeName", k.created_at "createdAt" from stock_counts k join stores s on s.id = k.store_id order by k.created_at desc limit 100`)).rows));
  app.get("/api/counts/:id", route(pool, "stock.count", ({ c, req }) => countView(c, uuid.parse(req.params.id))));
  app.post("/api/counts", route(pool, "stock.count", async ({ c, user, req }) => {
    const { storeId } = z.object({ storeId: uuid }).parse(req.body);
    await ensureOwned(c, "stores", [storeId]);
    const k = (await c.query("insert into stock_counts (tenant_id, store_id, created_by) values ($1,$2,$3) returning id", [user.tenantId, storeId, user.userId])).rows[0];
    await c.query(
      `insert into count_lines (tenant_id, count_id, item_id, batch_id, system_qty, counted_qty)
       select $1, $2, item_id, batch_id, quantity, quantity from stock_balances where store_id = $3 and quantity <> 0`, [user.tenantId, k.id, storeId]);
    return countView(c, k.id);
  }, 201));
  app.put("/api/counts/:id/lines", route(pool, "stock.count", async ({ c, req }) => {
    const id = uuid.parse(req.params.id);
    const b = z.object({ lines: z.array(z.object({ lineId: uuid, countedQty: z.coerce.number().min(0).max(1_000_000), reason: z.string().trim().max(300).nullish() })).min(1) }).parse(req.body);
    const k = (await c.query("select status from stock_counts where id = $1", [id])).rows[0];
    if (!k) throw notFound("Count");
    if (k.status !== "open") throw new HttpError(409, "locked", "This count has been posted.");
    for (const l of b.lines) {
      const r = await c.query("update count_lines set counted_qty = $3, reason = $4 where id = $1 and count_id = $2", [l.lineId, id, l.countedQty, l.reason ?? null]);
      if (!r.rowCount) throw notFound("Count line");
    }
    return countView(c, id);
  }));
  // Posting writes one adjustment per line that differs. A reason is mandatory for every variance.
  app.post("/api/counts/:id/post", route(pool, "stock.adjust", async ({ c, user, req }) => {
    const id = uuid.parse(req.params.id);
    const k = (await c.query("select * from stock_counts where id = $1 for update", [id])).rows[0];
    if (!k) throw notFound("Count");
    if (k.status === "posted") return countView(c, id);
    const lines = (await c.query("select * from count_lines where count_id = $1 order by id", [id])).rows;
    for (const l of lines) {
      const cur = Number((await c.query("select coalesce(sum(quantity),0) q from stock_balances where batch_id=$1 and store_id=$2", [l.batch_id, k.store_id])).rows[0].q);
      const delta = Number(l.counted_qty) - cur;
      if (Math.abs(delta) < 0.0005) continue;
      if (!(l.reason && l.reason.length >= 3)) throw new HttpError(409, "reason_required", "Every variance needs a reason before the count can be posted.");
      await postMovement(c, {
        tenantId: user.tenantId, type: "count_adjustment", itemId: l.item_id, batchId: l.batch_id, quantity: Math.abs(delta).toFixed(3),
        fromStoreId: delta < 0 ? k.store_id : null, toStoreId: delta > 0 ? k.store_id : null, userId: user.userId,
        reason: l.reason, reference: `count:${id}`, idempotencyKey: `count:${id}:${l.id}`,
      });
    }
    await c.query("update stock_counts set status='posted', posted_at=now() where id=$1", [id]);
    await auditTx(c, user, "count.post", "stock_count", id);
    return countView(c, id);
  }));
}
