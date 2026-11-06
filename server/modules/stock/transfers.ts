import type { Express } from "express";
import type pg from "pg";
import { z } from "zod";
import { auditTx, ensureOwned, HttpError, notFound, route } from "../../http/route";
import { uuid, qty } from "../../http/schemas";
import { suggestFefo, transferStock } from "../stock/ledger";
import { can } from "../auth/permissions";
import { transitStore } from "./transit";

export function registerTransferRoutes(app: Express, pool: pg.Pool) {
  // Transfers --------------------------------------------------------------------------
  const transferView = async (c: pg.PoolClient, id: string) => {
    const t = (await c.query(
      `select t.id, t.status, t.from_store_id "fromStoreId", f.name "fromStore", t.to_store_id "toStoreId", d.name "toStore",
              t.created_at "createdAt", t.dispatched_at "dispatchedAt", t.received_at "receivedAt"
         from transfers t join stores f on f.id = t.from_store_id join stores d on d.id = t.to_store_id where t.id = $1`, [id])).rows[0];
    if (!t) throw notFound("Transfer");
    t.lines = (await c.query(
      `select l.id, l.item_id "itemId", i.generic_name "itemName", l.batch_id "batchId", b.batch_no "batchNo",
              l.sent_qty::float "sentQty", l.received_qty::float "receivedQty", l.discrepancy_reason "discrepancyReason"
         from transfer_lines l join items i on i.id = l.item_id join batches b on b.id = l.batch_id where l.transfer_id = $1 order by l.id`, [id])).rows;
    return t;
  };

  app.get("/api/transfers", route(pool, "transfer.write", async ({ c, req }) =>
    (await c.query(
      `select t.id, t.status, f.name "fromStore", d.name "toStore", t.created_at "createdAt",
              exists (select 1 from transfer_lines l where l.transfer_id = t.id and l.received_qty is not null and l.received_qty < l.sent_qty) "hasDiscrepancy"
         from transfers t join stores f on f.id = t.from_store_id join stores d on d.id = t.to_store_id
        where ($1::text is null or t.status = $1) order by t.created_at desc limit 200`, [req.query.status ?? null])).rows));
  app.get("/api/transfers/:id", route(pool, "transfer.write", ({ c, req }) => transferView(c, uuid.parse(req.params.id))));

  app.post("/api/transfers", route(pool, "transfer.write", async ({ c, user, req }) => {
    const b = z.object({ fromStoreId: uuid, toStoreId: uuid, lines: z.array(z.object({ itemId: uuid, quantity: qty })).min(1, "Add at least one item").max(100) }).parse(req.body);
    if (b.fromStoreId === b.toStoreId) throw new HttpError(400, "invalid", "toStoreId: choose a different store");
    await ensureOwned(c, "stores", [b.fromStoreId, b.toStoreId]);
    await ensureOwned(c, "items", b.lines.map(l => l.itemId));
    // Reserve nothing now. Check availability so an impossible request is caught early.
    for (const l of b.lines) await suggestFefo(c, l.itemId, b.fromStoreId, l.quantity);
    const t = (await c.query("insert into transfers (tenant_id, from_store_id, to_store_id, created_by) values ($1,$2,$3,$4) returning id",
      [user.tenantId, b.fromStoreId, b.toStoreId, user.userId])).rows[0];
    // The draft records the batches it would take now (first-expiry-first-out).
    for (const l of b.lines) {
      const plan = await suggestFefo(c, l.itemId, b.fromStoreId, l.quantity);
      for (const a of plan) {
        await c.query("insert into transfer_lines (tenant_id, transfer_id, item_id, batch_id, sent_qty) values ($1,$2,$3,$4,$5)",
          [user.tenantId, t.id, l.itemId, a.batchId, a.take]);
      }
    }
    await auditTx(c, user, "transfer.create", "transfer", t.id);
    return transferView(c, t.id);
  }, 201));

  app.post("/api/transfers/:id/dispatch", route(pool, "transfer.write", async ({ c, user, req }) => {
    const id = uuid.parse(req.params.id);
    const t = (await c.query("select * from transfers where id = $1 for update", [id])).rows[0];
    if (!t) throw notFound("Transfer");
    if (t.status === "dispatched") return transferView(c, id);
    if (t.status !== "draft") throw new HttpError(409, "invalid", `A ${t.status} transfer cannot be dispatched.`);
    const transit = await transitStore(c, user.tenantId);
    const lines = (await c.query("select * from transfer_lines where transfer_id = $1 order by id", [id])).rows;
    for (const l of lines) {
      await transferStock(c, {
        tenantId: user.tenantId, itemId: l.item_id, batchId: l.batch_id, quantity: l.sent_qty, fromStoreId: t.from_store_id,
        toStoreId: transit, userId: user.userId, reference: `transfer:${id}:out`, idempotencyKey: `transfer:${id}:${l.id}:dispatch`,
      });
    }
    await c.query("update transfers set status='dispatched', dispatched_at=now() where id=$1", [id]);
    await auditTx(c, user, "transfer.dispatch", "transfer", id);
    return transferView(c, id);
  }));

  app.post("/api/transfers/:id/receive", route(pool, "transfer.write", async ({ c, user, req }) => {
    const id = uuid.parse(req.params.id);
    const b = z.object({ lines: z.array(z.object({ lineId: uuid, receivedQty: z.coerce.number().min(0), reason: z.string().trim().max(300).optional() })).min(1) }).parse(req.body);
    const t = (await c.query("select * from transfers where id = $1 for update", [id])).rows[0];
    if (!t) throw notFound("Transfer");
    if (t.status === "received") return transferView(c, id);
    if (t.status !== "dispatched") throw new HttpError(409, "invalid", "Only a dispatched transfer can be received.");
    const transit = await transitStore(c, user.tenantId);
    const lines = (await c.query("select * from transfer_lines where transfer_id = $1 order by id", [id])).rows;
    if (b.lines.length !== lines.length) throw new HttpError(400, "invalid", "lines: give a received quantity for every line");
    for (const l of lines) {
      const got = b.lines.find(x => x.lineId === l.id);
      if (!got) throw new HttpError(400, "invalid", "lines: unknown line");
      const sent = Number(l.sent_qty);
      if (got.receivedQty > sent) throw new HttpError(409, "over_received", "You cannot receive more than was sent.");
      if (got.receivedQty < sent && !(got.reason && got.reason.length >= 3)) {
        throw new HttpError(409, "reason_required", "Say why the received quantity is lower than what was sent.");
      }
      if (got.receivedQty > 0) {
        await transferStock(c, {
          tenantId: user.tenantId, itemId: l.item_id, batchId: l.batch_id, quantity: got.receivedQty, fromStoreId: transit,
          toStoreId: t.to_store_id, userId: user.userId, reference: `transfer:${id}:in`, idempotencyKey: `transfer:${id}:${l.id}:receive`,
        });
      }
      await c.query("update transfer_lines set received_qty = $2, discrepancy_reason = $3 where id = $1",
        [l.id, got.receivedQty, got.receivedQty < sent ? got.reason : null]);
      if (got.receivedQty < sent) {
        await c.query("insert into alerts (tenant_id, kind, severity, message, ref) values ($1,'transfer_discrepancy','warning',$2,$3)",
          [user.tenantId, `Transfer received ${got.receivedQty} of ${sent}: ${got.reason}`, `transfer:${id}`]);
      }
    }
    await c.query("update transfers set status='received', received_at=now(), received_by=$2 where id=$1", [id, user.userId]);
    await auditTx(c, user, "transfer.receive", "transfer", id);
    return transferView(c, id);
  }));
}
