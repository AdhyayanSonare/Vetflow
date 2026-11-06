import { randomUUID } from "node:crypto";
import type { Express } from "express";
import type pg from "pg";
import { z } from "zod";
import { issueFefo, postMovement, suggestFefo, transferStock } from "../ledger";
import { auditTx, ensureOwned, HttpError, notFound, route } from "./helpers";

const uuid = z.string().uuid();
const qty = z.coerce.number().positive().max(1_000_000);
const reasonText = z.string().trim().min(3, "A reason is required").max(300);

/** The in-transit store holds goods that have left one store and not yet reached the next. */
async function transitStore(c: pg.PoolClient, tenantId: string): Promise<string> {
  const r = await c.query(
    `insert into stores (tenant_id, kind, name) values ($1,'transit','In transit')
     on conflict (tenant_id, name) do update set kind = 'transit' returning id`, [tenantId]);
  return r.rows[0].id;
}

export function registerStockOpsRoutes(app: Express, pool: pg.Pool) {
  // Departments ----------------------------------------------------------------------
  app.get("/api/departments", route(pool, "catalogue.read", async ({ c }) =>
    (await c.query(`select id, name, branch_id "branchId" from departments order by name`)).rows));
  app.post("/api/departments", route(pool, "settings.manage", async ({ c, user, req }) => {
    const b = z.object({ branchId: uuid, name: z.string().trim().min(1).max(80) }).parse(req.body);
    await ensureOwned(c, "branches", [b.branchId]);
    const r = await c.query("insert into departments (tenant_id, branch_id, name) values ($1,$2,$3) returning id, name", [user.tenantId, b.branchId, b.name]);
    await auditTx(c, user, "department.create", "department", r.rows[0].id);
    return r.rows[0];
  }, 201));

  // Issue to a department and return to store -------------------------------------------
  app.post("/api/stock/issue", route(pool, "stock.issue", async ({ c, user, req }) => {
    const b = z.object({ itemId: uuid, storeId: uuid, quantity: qty, departmentId: uuid.nullish(), reason: reasonText }).parse(req.body);
    await ensureOwned(c, "items", [b.itemId]);
    await ensureOwned(c, "stores", [b.storeId]);
    await ensureOwned(c, "departments", [b.departmentId]);
    const plan = await issueFefo(c, {
      tenantId: user.tenantId, type: "issue", itemId: b.itemId, storeId: b.storeId, quantity: b.quantity, userId: user.userId,
      reason: b.reason, reference: b.departmentId ? `dept:${b.departmentId}` : "issue", idempotencyKey: String(req.get("idempotency-key") ?? randomUUID()),
    });
    await auditTx(c, user, "stock.issue", "item", b.itemId, { quantity: b.quantity, departmentId: b.departmentId }, b.reason);
    return { allocations: plan };
  }, 201));

  app.post("/api/stock/return", route(pool, "stock.issue", async ({ c, user, req }) => {
    const b = z.object({ itemId: uuid, batchId: uuid, fromStoreId: uuid, toStoreId: uuid, quantity: qty, reason: reasonText }).parse(req.body);
    if (b.fromStoreId === b.toStoreId) throw new HttpError(400, "invalid", "toStoreId: choose a different store");
    await ensureOwned(c, "items", [b.itemId]);
    await ensureOwned(c, "batches", [b.batchId]);
    await ensureOwned(c, "stores", [b.fromStoreId, b.toStoreId]);
    const id = await postMovement(c, {
      tenantId: user.tenantId, type: "return_to_store", itemId: b.itemId, batchId: b.batchId, quantity: b.quantity,
      fromStoreId: b.fromStoreId, toStoreId: b.toStoreId, userId: user.userId, reason: b.reason, reference: "return",
      idempotencyKey: String(req.get("idempotency-key") ?? randomUUID()),
    });
    return { ledgerId: id };
  }, 201));

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

  // Multi-dose vials -------------------------------------------------------------------------
  const vialSelect = `v.id, v.item_id "itemId", i.generic_name "itemName", v.batch_id "batchId", b.batch_no "batchNo", v.store_id "storeId",
    v.opened_at "openedAt", v.beyond_use_at "beyondUseAt", (v.beyond_use_at < now()) "pastBeyondUse",
    v.volume_ml::float "volumeMl", v.remaining_ml::float "remainingMl", v.status`;
  app.get("/api/vials", route(pool, "catalogue.read", async ({ c, req }) =>
    (await c.query(
      `select ${vialSelect} from open_vials v join items i on i.id = v.item_id join batches b on b.id = v.batch_id
        where ($1::text is null or v.status = $1) order by v.beyond_use_at limit 200`, [req.query.status ?? "open"])).rows));

  // Opening a vial takes one sealed unit out of stock. Draws then reduce the open vial only.
  app.post("/api/vials/open", route(pool, "stock.issue", async ({ c, user, req }) => {
    const b = z.object({ itemId: uuid, storeId: uuid }).parse(req.body);
    await ensureOwned(c, "items", [b.itemId]);
    await ensureOwned(c, "stores", [b.storeId]);
    const item = (await c.query("select multi_dose, dose_volume_ml, beyond_use_days from items where id = $1", [b.itemId])).rows[0];
    if (!item?.multi_dose || !item.dose_volume_ml) throw new HttpError(409, "not_multi_dose", "This item is not set up as a multi-dose container.");
    const vialId = randomUUID();
    const plan = await issueFefo(c, {
      tenantId: user.tenantId, type: "issue", itemId: b.itemId, storeId: b.storeId, quantity: 1, userId: user.userId,
      reason: "Opened multi-dose vial", reference: `vial:${vialId}`, idempotencyKey: `vial:${vialId}`,
    });
    const bud = Number(item.beyond_use_days ?? 28);
    await c.query(
      `insert into open_vials (id, tenant_id, item_id, batch_id, store_id, beyond_use_at, volume_ml, remaining_ml)
       values ($1,$2,$3,$4,$5, now() + make_interval(days => $6), $7, $7)`,
      [vialId, user.tenantId, b.itemId, plan[0].batchId, b.storeId, bud, item.dose_volume_ml]);
    await auditTx(c, user, "vial.open", "open_vial", vialId);
    return (await c.query(`select ${vialSelect} from open_vials v join items i on i.id = v.item_id join batches b on b.id = v.batch_id where v.id = $1`, [vialId])).rows[0];
  }, 201));

  app.post("/api/vials/:id/draw", route(pool, "dispense.write", async ({ c, user, req }) => {
    const id = uuid.parse(req.params.id);
    const b = z.object({ ml: qty, animalId: uuid.nullish(), prescriptionId: uuid.nullish() }).parse(req.body);
    if (!b.animalId && !b.prescriptionId) throw new HttpError(400, "invalid", "animalId: say which patient the dose is for");
    await ensureOwned(c, "animals", [b.animalId]);
    await ensureOwned(c, "prescriptions", [b.prescriptionId]);
    const v = (await c.query("select * from open_vials where id = $1 for update", [id])).rows[0];
    if (!v) throw notFound("Vial");
    if (v.status !== "open") throw new HttpError(409, "vial_closed", `This vial is ${v.status}.`);
    if (new Date(v.beyond_use_at) < new Date()) throw new HttpError(409, "beyond_use", "This vial is past its beyond-use date and must be discarded.");
    if (b.ml > Number(v.remaining_ml) + 1e-9) throw new HttpError(409, "insufficient", `Only ${Number(v.remaining_ml)} ml is left in this vial.`);
    const left = Number(v.remaining_ml) - b.ml;
    await c.query("update open_vials set remaining_ml = $2, status = case when $2 <= 0.0005 then 'empty' else status end where id = $1", [id, left]);
    await c.query("insert into vial_draws (tenant_id, vial_id, ml, animal_id, prescription_id, user_id) values ($1,$2,$3,$4,$5,$6)",
      [user.tenantId, id, b.ml, b.animalId ?? null, b.prescriptionId ?? null, user.userId]);
    await auditTx(c, user, "vial.draw", "open_vial", id, { ml: b.ml });
    return (await c.query(`select ${vialSelect} from open_vials v join items i on i.id = v.item_id join batches b on b.id = v.batch_id where v.id = $1`, [id])).rows[0];
  }));

  app.post("/api/vials/:id/discard", route(pool, "stock.adjust", async ({ c, user, req }) => {
    const id = uuid.parse(req.params.id);
    const { reason } = z.object({ reason: reasonText }).parse(req.body);
    const r = await c.query(
      "update open_vials set status='discarded', discard_reason=$2, discarded_ml=remaining_ml where id=$1 and status='open' returning id", [id, reason]);
    if (!r.rowCount) throw new HttpError(409, "invalid", "Only an open vial can be discarded.");
    await auditTx(c, user, "vial.discard", "open_vial", id, undefined, reason);
    return { ok: true };
  }));
}
