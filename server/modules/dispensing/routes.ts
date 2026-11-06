import type { Express } from "express";
import type pg from "pg";
import { z } from "zod";
import { auditTx, ensureOwned, HttpError, notFound, route } from "../../http/route";
import { uuid, qty } from "../../http/schemas";
import { issueFefo } from "../stock/ledger";
import { verifyPassword } from "../auth/service";
import { can } from "../auth/permissions";

export function registerDispensingRoutes(app: Express, pool: pg.Pool) {
  // Dispensing ---------------------------------------------------------------------
  const DispBody = z.object({
    storeId: uuid, prescriptionId: uuid.nullish(), counterReason: z.string().trim().min(3).max(200).nullish(),
    lines: z.array(z.object({ itemId: uuid, quantity: z.coerce.number().positive().max(100000) })).min(1, "Add at least one item").max(50),
  });
  const dispView = async (c: pg.PoolClient, id: string) => {
    const d = (await c.query(
      `select d.id, d.store_id "storeId", d.prescription_id "prescriptionId", d.animal_id "animalId", d.counter_reason "counterReason",
              d.status, d.created_at "createdAt", d.confirmed_at "confirmedAt" from dispenses d where d.id = $1`, [id])).rows[0];
    if (!d) throw notFound("Dispense");
    d.lines = (await c.query(
      `select dl.id, dl.item_id "itemId", i.generic_name "itemName", i.controlled, dl.batch_id "batchId", b.batch_no "batchNo", dl.quantity::float quantity
         from dispense_lines dl join items i on i.id = dl.item_id left join batches b on b.id = dl.batch_id where dl.dispense_id = $1 order by dl.id`, [id])).rows;
    return d;
  };
  app.get("/api/dispenses", route(pool, "dispense.write", async ({ c, req }) =>
    (await c.query(
      `select d.id, d.status, d.created_at "createdAt", d.counter_reason "counterReason", a.name "animalName", d.prescription_id "prescriptionId"
         from dispenses d left join animals a on a.id = d.animal_id where ($1::text is null or d.status = $1)
        order by d.created_at desc limit 200`, [req.query.status ?? null])).rows));
  app.get("/api/dispenses/:id", route(pool, "dispense.write", ({ c, req }) => dispView(c, uuid.parse(req.params.id))));

  app.post("/api/dispenses", route(pool, "dispense.write", async ({ c, user, req }) => {
    const b = DispBody.parse(req.body);
    await ensureOwned(c, "stores", [b.storeId]);
    await ensureOwned(c, "items", b.lines.map(l => l.itemId));
    let animalId: string | null = null;
    if (b.prescriptionId) {
      const rx = (await c.query("select status, animal_id from prescriptions where id = $1", [b.prescriptionId])).rows[0];
      if (!rx) throw notFound("Prescription");
      if (rx.status !== "approved") throw new HttpError(409, "not_approved", "Only an approved prescription can be dispensed.");
      animalId = rx.animal_id;
    } else {
      if (!b.counterReason) throw new HttpError(400, "invalid", "counterReason: a counter sale needs a reason");
            if (!can(user.role, "dispense.counter")) throw new HttpError(403, "forbidden", "Your role cannot make counter sales without a prescription.");
    }
    const d = await c.query(
      "insert into dispenses (tenant_id, store_id, prescription_id, animal_id, counter_reason, created_by) values ($1,$2,$3,$4,$5,$6) returning id",
      [user.tenantId, b.storeId, b.prescriptionId ?? null, animalId, b.counterReason ?? null, user.userId]);
    for (const l of b.lines) {
      await c.query("insert into dispense_lines (tenant_id, dispense_id, item_id, quantity) values ($1,$2,$3,$4)", [user.tenantId, d.rows[0].id, l.itemId, l.quantity]);
    }
    await auditTx(c, user, "dispense.create", "dispense", d.rows[0].id);
    return dispView(c, d.rows[0].id);
  }, 201));

  // Confirming is the only step that deducts clinical stock.
  app.post("/api/dispenses/:id/confirm", route(pool, "dispense.write", async ({ c, user, req }) => {
    const id = uuid.parse(req.params.id);
    const witness = z.object({ witnessUserId: uuid.optional(), witnessPassword: z.string().max(200).optional() }).parse(req.body ?? {});
    const d = (await c.query("select * from dispenses where id = $1 for update", [id])).rows[0];
    if (!d) throw notFound("Dispense");
    if (d.status === "confirmed") return dispView(c, id);
    if (d.status !== "draft") throw new HttpError(409, "invalid", `A ${d.status} dispense cannot be confirmed.`);

    const lines = (await c.query(
      "select dl.item_id, dl.quantity::float qty, i.controlled, i.generic_name from dispense_lines dl join items i on i.id = dl.item_id where dl.dispense_id = $1 order by dl.id", [id])).rows;

    if (d.prescription_id) {
      const rx = (await c.query("select status from prescriptions where id = $1", [d.prescription_id])).rows[0];
      if (rx?.status !== "approved") throw new HttpError(409, "not_approved", "The prescription is no longer approved.");
      const limits = (await c.query(
        `select l.item_id, sum(l.quantity)::float prescribed,
                coalesce((select sum(dl.quantity) from dispense_lines dl join dispenses x on x.id = dl.dispense_id
                           where x.prescription_id = $1 and x.status = 'confirmed' and dl.item_id = l.item_id),0)::float dispensed
           from prescription_lines l where l.prescription_id = $1 and l.item_id is not null group by l.item_id`, [d.prescription_id])).rows;
      for (const l of lines) {
        const lim = limits.find((x: { item_id: string }) => x.item_id === l.item_id);
        if (!lim) throw new HttpError(409, "not_prescribed", `${l.generic_name} is not on this prescription.`);
        if (lim.prescribed != null && lim.dispensed + l.qty > lim.prescribed + 1e-9) {
          throw new HttpError(409, "over_prescribed", `${l.generic_name}: only ${(lim.prescribed - lim.dispensed).toFixed(3).replace(/\.?0+$/, "")} left on this prescription.`);
        }
      }
    }

    // Controlled medicines need a second person to confirm with their own password.
    if (lines.some((l: { controlled: boolean }) => l.controlled)) {
      if (!witness.witnessUserId || !witness.witnessPassword) {
        throw new HttpError(409, "witness_required", "A controlled medicine needs a second user to confirm.");
      }
      if (witness.witnessUserId === user.userId) throw new HttpError(409, "witness_same_user", "The second confirmation must come from a different user.");
      const w = (await c.query("select password_hash, role, active from users where id = $1", [witness.witnessUserId])).rows[0];
      if (!w || !w.active || !["admin", "inventory_manager", "pharmacist", "vet"].includes(w.role)
          || !(await verifyPassword(w.password_hash, witness.witnessPassword))) {
        throw new HttpError(403, "witness_invalid", "The second user's details are not correct.");
      }
      await auditTx(c, user, "dispense.witness", "dispense", id, { witnessUserId: witness.witnessUserId });
    }

    await c.query("delete from dispense_lines where dispense_id = $1", [id]);
    for (const l of lines) {
      const plan = await issueFefo(c, {
        tenantId: user.tenantId, type: "dispense", itemId: l.item_id, storeId: d.store_id, quantity: l.qty, userId: user.userId,
        reason: d.counter_reason ?? undefined, reference: `dispense:${id}`, idempotencyKey: `dispense:${id}:${l.item_id}`,
      });
      for (const a of plan) {
        await c.query("insert into dispense_lines (tenant_id, dispense_id, item_id, batch_id, quantity) values ($1,$2,$3,$4,$5)",
          [user.tenantId, id, l.item_id, a.batchId, a.take]);
      }
    }
    await c.query("update dispenses set status='confirmed', confirmed_by=$2, confirmed_at=now() where id=$1", [id, user.userId]);
    await auditTx(c, user, "dispense.confirm", "dispense", id);
    return dispView(c, id);
  }));

  app.post("/api/dispenses/:id/cancel", route(pool, "dispense.write", async ({ c, user, req }) => {
    const id = uuid.parse(req.params.id);
    const r = await c.query("update dispenses set status='cancelled' where id=$1 and status='draft' returning id", [id]);
    if (!r.rowCount) throw new HttpError(409, "invalid", "Only a draft dispense can be cancelled.");
    await auditTx(c, user, "dispense.cancel", "dispense", id);
    return { ok: true };
  }));
}
