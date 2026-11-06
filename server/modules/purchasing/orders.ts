import type { Express } from "express";
import type pg from "pg";
import { z } from "zod";
import { auditTx, ensureOwned, HttpError, notFound, route } from "../../http/route";
import { date, paise, qtyNum, uuid } from "../../http/schemas";

const orderSelect = `o.id, o.number, o.status, o.supplier_id "supplierId", s.name "supplierName", o.store_id "storeId", st.name "storeName",
  to_char(o.expected_date,'YYYY-MM-DD') "expectedDate", o.notes, o.created_at "createdAt"`;

async function orderView(c: pg.PoolClient, id: string) {
  const o = (await c.query(
    `select ${orderSelect} from purchase_orders o join suppliers s on s.id = o.supplier_id join stores st on st.id = o.store_id where o.id = $1`, [id])).rows[0];
  if (!o) throw notFound("Purchase order");
  o.lines = (await c.query(
    `select l.id, l.item_id "itemId", i.code, i.generic_name "itemName", i.unit, l.ordered_qty::float "orderedQty", l.received_qty::float "receivedQty",
            (l.ordered_qty - l.received_qty)::float "outstandingQty", l.unit_cost_paise::float "unitCostPaise"
       from purchase_order_lines l join items i on i.id = l.item_id where l.po_id = $1 order by i.generic_name`, [id])).rows;
  return o;
}

/**
 * After a receipt linked to an order is confirmed, add the received quantities to the order and
 * move the order to partially received or received.
 */
export async function applyReceiptToOrder(c: pg.PoolClient, receiptId: string) {
  const lines = (await c.query("select po_line_id, quantity from receipt_lines where receipt_id = $1 and po_line_id is not null", [receiptId])).rows;
  if (!lines.length) return;
  for (const l of lines) await c.query("update purchase_order_lines set received_qty = received_qty + $2 where id = $1", [l.po_line_id, l.quantity]);
  const poId = (await c.query("select po_id from purchase_receipts where id = $1", [receiptId])).rows[0]?.po_id;
  if (!poId) return;
  const t = (await c.query(
    `select bool_and(received_qty >= ordered_qty) done, bool_or(received_qty > 0) any_received from purchase_order_lines where po_id = $1`, [poId])).rows[0];
  await c.query("update purchase_orders set status = $2 where id = $1 and status in ('sent','partially_received')", [poId, t.done ? "received" : t.any_received ? "partially_received" : "sent"]);
}

export function registerPurchaseOrderRoutes(app: Express, pool: pg.Pool) {
  app.get("/api/purchase-orders", route(pool, "purchase.write", async ({ c, req }) =>
    (await c.query(
      `select ${orderSelect}, (select count(*)::int from purchase_order_lines l where l.po_id = o.id) "lineCount",
              (select coalesce(sum(l.ordered_qty * l.unit_cost_paise),0)::float from purchase_order_lines l where l.po_id = o.id) "valuePaise"
         from purchase_orders o join suppliers s on s.id = o.supplier_id join stores st on st.id = o.store_id
        where ($1::text is null or o.status = $1) order by o.created_at desc limit 200`, [req.query.status ?? null])).rows));

  app.get("/api/purchase-orders/:id", route(pool, "purchase.write", ({ c, req }) => orderView(c, uuid.parse(req.params.id))));

  app.post("/api/purchase-orders", route(pool, "purchase.write", async ({ c, user, req }) => {
    const b = z.object({
      supplierId: uuid, storeId: uuid, expectedDate: date.nullish(), notes: z.string().trim().max(500).nullish(),
      lines: z.array(z.object({ itemId: uuid, quantity: qtyNum, unitCostPaise: paise.default(0) })).min(1, "Add at least one item").max(300),
    }).parse(req.body);
    await ensureOwned(c, "suppliers", [b.supplierId]);
    await ensureOwned(c, "stores", [b.storeId]);
    await ensureOwned(c, "items", b.lines.map(l => l.itemId));
    const o = (await c.query(
      "insert into purchase_orders (tenant_id, supplier_id, store_id, expected_date, notes, created_by) values ($1,$2,$3,$4,$5,$6) returning id",
      [user.tenantId, b.supplierId, b.storeId, b.expectedDate ?? null, b.notes ?? null, user.userId])).rows[0];
    for (const l of b.lines) {
      await c.query("insert into purchase_order_lines (tenant_id, po_id, item_id, ordered_qty, unit_cost_paise) values ($1,$2,$3,$4,$5)",
        [user.tenantId, o.id, l.itemId, l.quantity, l.unitCostPaise]);
    }
    await auditTx(c, user, "po.create", "purchase_order", o.id);
    return orderView(c, o.id);
  }, 201));

  // Draft orders from the low-stock list: one per default supplier. Items without a supplier are reported, not guessed.
  app.post("/api/purchase-orders/from-low-stock", route(pool, "purchase.write", async ({ c, user, req }) => {
    const b = z.object({ storeId: uuid, itemIds: z.array(uuid).max(500).optional() }).parse(req.body);
    await ensureOwned(c, "stores", [b.storeId]);
    await ensureOwned(c, "items", b.itemIds ?? []);
    const low = (await c.query(
      `select * from (
         select i.id, i.generic_name, i.default_supplier_id, coalesce(i.reorder_qty,0)::float reorder_qty, i.min_qty::float min_qty,
                coalesce(sum(sb.quantity),0)::float on_hand
           from items i left join stock_balances sb on sb.item_id = i.id where i.active and i.min_qty > 0 group by i.id) t
       where on_hand <= min_qty and ($1::uuid[] is null or id = any($1::uuid[]))`, [b.itemIds ?? null])).rows;
    const bySupplier = new Map<string, typeof low>();
    const skipped: Array<{ itemId: string; name: string; reason: string }> = [];
    for (const i of low) {
      if (!i.default_supplier_id) { skipped.push({ itemId: i.id, name: i.generic_name, reason: "No default supplier set" }); continue; }
      bySupplier.set(i.default_supplier_id, [...(bySupplier.get(i.default_supplier_id) ?? []), i]);
    }
    const created: string[] = [];
    for (const [supplierId, items] of bySupplier) {
      const o = (await c.query("insert into purchase_orders (tenant_id, supplier_id, store_id, notes, created_by) values ($1,$2,$3,'Created from low stock',$4) returning id",
        [user.tenantId, supplierId, b.storeId, user.userId])).rows[0];
      for (const i of items) {
        const qty = Math.max(i.reorder_qty, i.min_qty * 2 - i.on_hand, 1);
        await c.query("insert into purchase_order_lines (tenant_id, po_id, item_id, ordered_qty) values ($1,$2,$3,$4)", [user.tenantId, o.id, i.id, qty]);
      }
      await auditTx(c, user, "po.create", "purchase_order", o.id, { fromLowStock: items.length });
      created.push(o.id);
    }
    return { created, skipped };
  }, 201));

  const setStatus = (from: string[], to: string, action: string, perm: "purchase.write" | "purchase.confirm") =>
    route(pool, perm, async ({ c, user, req }) => {
      const id = uuid.parse(req.params.id);
      const r = await c.query("update purchase_orders set status = $2 where id = $1 and status = any($3::text[]) returning id", [id, to, from]);
      if (!r.rowCount) {
        await orderView(c, id);
        throw new HttpError(409, "invalid", `A purchase order that is not ${from.join(" or ")} cannot be changed this way.`);
      }
      await auditTx(c, user, action, "purchase_order", id);
      return orderView(c, id);
    });
  app.post("/api/purchase-orders/:id/send", setStatus(["draft"], "sent", "po.send", "purchase.confirm"));
  app.post("/api/purchase-orders/:id/cancel", route(pool, "purchase.confirm", async ({ c, user, req }) => {
    const id = uuid.parse(req.params.id);
    const received = (await c.query("select coalesce(sum(received_qty),0)::float q from purchase_order_lines where po_id = $1", [id])).rows[0].q;
    if (received > 0) throw new HttpError(409, "invalid", "This order has received stock and cannot be cancelled.");
    const r = await c.query("update purchase_orders set status = 'cancelled' where id = $1 and status in ('draft','sent') returning id", [id]);
    if (!r.rowCount) { await orderView(c, id); throw new HttpError(409, "invalid", "Only a draft or sent order can be cancelled."); }
    await auditTx(c, user, "po.cancel", "purchase_order", id);
    return orderView(c, id);
  }));

  // Receiving against an order makes a draft receipt. Stock rises only when that receipt is confirmed,
  // and a part delivery leaves the rest of the order open.
  app.post("/api/purchase-orders/:id/receive", route(pool, "purchase.write", async ({ c, user, req }) => {
    const id = uuid.parse(req.params.id);
    const b = z.object({
      invoiceNo: z.string().trim().max(60).nullish(), invoiceDate: date.nullish(),
      lines: z.array(z.object({ poLineId: uuid, quantity: qtyNum, batchNo: z.string().trim().min(1).max(60), expiryDate: date, mfgDate: date.nullish(), unitCostPaise: paise.optional() })).min(1),
    }).parse(req.body);
    const o = (await c.query("select * from purchase_orders where id = $1 for update", [id])).rows[0];
    if (!o) throw notFound("Purchase order");
    if (!["sent", "partially_received"].includes(o.status)) throw new HttpError(409, "invalid", "Send the order before receiving against it.");
    const lines = (await c.query("select * from purchase_order_lines where po_id = $1", [id])).rows;
    // Quantities already sitting on other draft receipts count as incoming.
    const pending = new Map<string, number>((await c.query(
      `select rl.po_line_id, sum(rl.quantity)::float q from receipt_lines rl join purchase_receipts r on r.id = rl.receipt_id
        where r.po_id = $1 and r.status = 'draft' group by rl.po_line_id`, [id])).rows.map(r => [r.po_line_id, r.q]));
    for (const l of b.lines) {
      const pl = lines.find(x => x.id === l.poLineId);
      if (!pl) throw notFound("Order line");
      const open = Number(pl.ordered_qty) - Number(pl.received_qty) - (pending.get(pl.id) ?? 0);
      if (l.quantity > open + 1e-9) throw new HttpError(409, "over_received", `Only ${Math.max(open, 0)} is still open on this order line.`);
    }
    const rc = (await c.query(
      `insert into purchase_receipts (tenant_id, supplier_id, store_id, invoice_no, invoice_date, po_id, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [user.tenantId, o.supplier_id, o.store_id, b.invoiceNo ?? null, b.invoiceDate ?? null, id, user.userId])).rows[0];
    for (const l of b.lines) {
      const pl = lines.find(x => x.id === l.poLineId)!;
      await c.query(
        `insert into receipt_lines (tenant_id, receipt_id, item_id, batch_no, expiry_date, mfg_date, quantity, unit_cost_paise, po_line_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [user.tenantId, rc.id, pl.item_id, l.batchNo, l.expiryDate, l.mfgDate ?? null, l.quantity, l.unitCostPaise ?? pl.unit_cost_paise, pl.id]);
    }
    await auditTx(c, user, "po.receive_draft", "purchase_order", id, { receiptId: rc.id });
    return { receiptId: rc.id, order: await orderView(c, id) };
  }, 201));
}
