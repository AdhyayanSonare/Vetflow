import { randomUUID } from "node:crypto";
import type { Express } from "express";
import type pg from "pg";
import { z } from "zod";
import { auditTx, ensureOwned, HttpError, notFound, route } from "../../http/route";
import { uuid, date, qty, reasonText } from "../../http/schemas";
import { issueFefo } from "../stock/ledger";
import { can } from "../auth/permissions";

export function registerVialRoutes(app: Express, pool: pg.Pool) {
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
