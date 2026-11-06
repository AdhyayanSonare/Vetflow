import type { Express } from "express";
import type pg from "pg";
import { z } from "zod";
import { auditTx, ensureOwned, HttpError, notFound, route } from "../../http/route";
import { date, text, uuid } from "../../http/schemas";

const AnimalBody = z.object({
  name: z.string().trim().min(1).max(100), species: z.string().trim().min(1).max(40), breed: text(80), sex: text(20),
  dob: date.nullish(), weightKg: z.coerce.number().positive().max(2000).nullish(), colour: text(60), microchip: text(40),
  allergies: text(500), conditions: text(500), branchId: uuid.nullish(), ownerId: uuid.nullish(),
  owner: z.object({ name: z.string().trim().min(1).max(120), phone: text(30), email: text(120), address: text(300) }).optional(),
});

const animalSelect = `a.id, a.code, a.name, a.species, a.breed, a.sex, to_char(a.dob,'YYYY-MM-DD') dob, a.weight_kg::float "weightKg",
  a.colour, a.microchip, a.allergies, a.conditions, a.active, a.branch_id "branchId",
  o.id "ownerId", o.name "ownerName", o.phone "ownerPhone", o.email "ownerEmail", o.address "ownerAddress"`;

const consultSelect = `c.id, c.animal_id "animalId", a.name "animalName", c.vet_id "vetId", u.name "vetName", c.status, c.complaint, c.history, c.duration_text "durationText", c.follow_up_note "followUpNote", c.source,
  c.temperature_f::float "temperatureF", c.examination, c.diagnosis, c.treatment_plan "treatmentPlan",
  to_char(c.follow_up_date,'YYYY-MM-DD') "followUpDate", c.started_at "startedAt", c.completed_at "completedAt"`;

const ConsultBody = z.object({
  complaint: text(2000), history: text(4000), temperatureF: z.coerce.number().min(85).max(115).nullish(),
  examination: text(4000), diagnosis: text(2000), treatmentPlan: text(4000), followUpDate: date.nullish(),
  durationText: text(500), followUpNote: text(500), source: z.enum(["manual", "voice"]).optional(),
});

const LineBody = z.object({
  itemId: uuid.nullish(), drugText: z.string().trim().min(1).max(200), dose: text(60), route: text(40),
  frequency: text(60), duration: text(60), instructions: text(300), quantity: z.coerce.number().positive().max(100000).nullish(),
});

export function registerClinicalRoutes(app: Express, pool: pg.Pool) {
  // Animals and owners ----------------------------------------------------------
  app.get("/api/animals", route(pool, "clinical.read", async ({ c, req }) => {
    const q = String(req.query.q ?? "").trim();
    return (await c.query(
      `select ${animalSelect}, (select max(started_at) from consultations x where x.animal_id = a.id) "lastConsultation"
         from animals a join owners o on o.id = a.owner_id
        where a.active and ($1 = '' or a.name ilike '%'||$1||'%' or a.code ilike '%'||$1||'%' or o.name ilike '%'||$1||'%'
              or o.phone ilike '%'||$1||'%' or a.microchip = $1 or a.name % $1)
        order by a.created_at desc limit 100`, [q])).rows;
  }));

  app.post("/api/animals", route(pool, "clinical.write", async ({ c, user, req }) => {
    const b = AnimalBody.parse(req.body);
    await ensureOwned(c, "owners", [b.ownerId]);
    await ensureOwned(c, "branches", [b.branchId]);
    let ownerId = b.ownerId;
    if (!ownerId) {
      if (!b.owner) throw new HttpError(400, "invalid", "owner: add the owner's details");
      ownerId = (await c.query("insert into owners (tenant_id,name,phone,email,address) values ($1,$2,$3,$4,$5) returning id",
        [user.tenantId, b.owner.name, b.owner.phone ?? null, b.owner.email ?? null, b.owner.address ?? null])).rows[0].id;
    }
    const r = await c.query(
      `insert into animals (tenant_id,branch_id,owner_id,name,species,breed,sex,dob,weight_kg,colour,microchip,allergies,conditions)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
      [user.tenantId, b.branchId ?? null, ownerId, b.name, b.species, b.breed ?? null, b.sex ?? null, b.dob ?? null, b.weightKg ?? null,
        b.colour ?? null, b.microchip ?? null, b.allergies ?? null, b.conditions ?? null]);
    await auditTx(c, user, "animal.create", "animal", r.rows[0].id);
    return (await c.query(`select ${animalSelect} from animals a join owners o on o.id = a.owner_id where a.id = $1`, [r.rows[0].id])).rows[0];
  }, 201));

  app.get("/api/animals/:id", route(pool, "clinical.read", async ({ c, req }) => {
    const id = uuid.parse(req.params.id);
    const a = (await c.query(`select ${animalSelect} from animals a join owners o on o.id = a.owner_id where a.id = $1`, [id])).rows[0];
    if (!a) throw notFound("Patient");
    a.consultations = (await c.query(
      `select ${consultSelect} from consultations c join animals a on a.id = c.animal_id join users u on u.id = c.vet_id
        where c.animal_id = $1 order by c.started_at desc`, [id])).rows;
    a.prescriptions = (await c.query(
      `select id, status, source, created_at "createdAt", approved_at "approvedAt" from prescriptions where animal_id = $1 order by created_at desc`, [id])).rows;
    return a;
  }));

  app.patch("/api/animals/:id", route(pool, "clinical.write", async ({ c, user, req }) => {
    const id = uuid.parse(req.params.id);
    const b = AnimalBody.omit({ owner: true, ownerId: true }).partial().parse(req.body);
    const r = await c.query(
      `update animals set name = coalesce($2,name), species = coalesce($3,species), breed = coalesce($4,breed), sex = coalesce($5,sex),
         weight_kg = coalesce($6,weight_kg), colour = coalesce($7,colour), allergies = coalesce($8,allergies), conditions = coalesce($9,conditions)
       where id = $1 returning id`,
      [id, b.name ?? null, b.species ?? null, b.breed ?? null, b.sex ?? null, b.weightKg ?? null, b.colour ?? null, b.allergies ?? null, b.conditions ?? null]);
    if (!r.rowCount) throw notFound("Patient");
    await auditTx(c, user, "animal.update", "animal", id);
    return (await c.query(`select ${animalSelect} from animals a join owners o on o.id = a.owner_id where a.id = $1`, [id])).rows[0];
  }));

  // Consultations ----------------------------------------------------------------
  app.get("/api/consultations", route(pool, "clinical.read", async ({ c, req }) =>
    (await c.query(
      `select ${consultSelect} from consultations c join animals a on a.id = c.animal_id join users u on u.id = c.vet_id
        where ($1::text is null or c.status = $1) order by c.started_at desc limit 200`, [req.query.status ?? null])).rows));

  const getConsult = async (c: pg.PoolClient, id: string) => {
    const r = (await c.query(`select ${consultSelect} from consultations c join animals a on a.id = c.animal_id join users u on u.id = c.vet_id where c.id = $1`, [id])).rows[0];
    if (!r) throw notFound("Consultation");
    r.transcripts = (await c.query(
      `select id, language, provider, text, created_at "createdAt" from transcripts where consultation_id = $1 order by created_at`, [id])).rows;
    return r;
  };
  app.get("/api/consultations/:id", route(pool, "clinical.read", ({ c, req }) => getConsult(c, uuid.parse(req.params.id))));

  app.post("/api/consultations", route(pool, "clinical.write", async ({ c, user, req }) => {
    const b = ConsultBody.extend({ animalId: uuid }).parse(req.body);
    await ensureOwned(c, "animals", [b.animalId]);
    const r = await c.query(
      `insert into consultations (tenant_id, animal_id, vet_id, complaint, history, temperature_f, examination, diagnosis, treatment_plan, follow_up_date, duration_text, follow_up_note, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
      [user.tenantId, b.animalId, user.userId, b.complaint ?? null, b.history ?? null, b.temperatureF ?? null, b.examination ?? null,
        b.diagnosis ?? null, b.treatmentPlan ?? null, b.followUpDate ?? null, b.durationText ?? null, b.followUpNote ?? null, b.source ?? "manual"]);
    await auditTx(c, user, "consultation.create", "consultation", r.rows[0].id);
    return getConsult(c, r.rows[0].id);
  }, 201));

  app.patch("/api/consultations/:id", route(pool, "clinical.write", async ({ c, user, req }) => {
    const id = uuid.parse(req.params.id);
    const b = ConsultBody.parse(req.body);
    const cur = (await c.query("select status from consultations where id = $1 for update", [id])).rows[0];
    if (!cur) throw notFound("Consultation");
    if (cur.status === "completed") throw new HttpError(409, "locked", "A completed consultation cannot be edited.");
    await c.query(
      `update consultations set complaint = coalesce($2,complaint), history = coalesce($3,history), temperature_f = coalesce($4,temperature_f),
         examination = coalesce($5,examination), diagnosis = coalesce($6,diagnosis), treatment_plan = coalesce($7,treatment_plan),
         follow_up_date = coalesce($8,follow_up_date), duration_text = coalesce($9,duration_text), follow_up_note = coalesce($10,follow_up_note) where id = $1`,
      [id, b.complaint ?? null, b.history ?? null, b.temperatureF ?? null, b.examination ?? null, b.diagnosis ?? null, b.treatmentPlan ?? null, b.followUpDate ?? null, b.durationText ?? null, b.followUpNote ?? null]);
    await auditTx(c, user, "consultation.update", "consultation", id);
    return getConsult(c, id);
  }));

  app.post("/api/consultations/:id/complete", route(pool, "clinical.write", async ({ c, user, req }) => {
    const id = uuid.parse(req.params.id);
    const r = await c.query("update consultations set status='completed', completed_at = now() where id = $1 and status = 'draft' returning id", [id]);
    if (!r.rowCount) { await getConsult(c, id); throw new HttpError(409, "invalid", "This consultation is already completed."); }
    await auditTx(c, user, "consultation.complete", "consultation", id);
    return getConsult(c, id);
  }));

  // Transcripts are stored text. They never touch a prescription or stock by themselves.
  app.post("/api/consultations/:id/transcripts", route(pool, "clinical.write", async ({ c, user, req }) => {
    const id = uuid.parse(req.params.id);
    const b = z.object({ language: z.string().min(2).max(10), provider: z.string().max(40), text: z.string().min(1).max(50000), confidence: z.number().min(0).max(1).optional() }).parse(req.body);
    await ensureOwned(c, "consultations", [id]);
    const r = await c.query("insert into transcripts (tenant_id, consultation_id, language, provider, text, confidence) values ($1,$2,$3,$4,$5,$6) returning id",
      [user.tenantId, id, b.language, b.provider, b.text, b.confidence ?? null]);
    return { id: r.rows[0].id };
  }, 201));

  // Prescriptions ------------------------------------------------------------------
  const rxView = async (c: pg.PoolClient, id: string) => {
    const r = (await c.query(
      `select p.id, p.consultation_id "consultationId", p.animal_id "animalId", a.name "animalName", p.status, p.source,
              p.approved_at "approvedAt", ab.name "approvedByName", p.created_at "createdAt"
         from prescriptions p join animals a on a.id = p.animal_id left join users ab on ab.id = p.approved_by where p.id = $1`, [id])).rows[0];
    if (!r) throw notFound("Prescription");
    r.lines = (await c.query(
      `select l.id, l.item_id "itemId", l.drug_text "drugText", l.dose, l.route, l.frequency, l.duration, l.instructions, l.quantity::float quantity, l.unmatched,
              coalesce((select sum(dl.quantity) from dispense_lines dl join dispenses d on d.id = dl.dispense_id
                         where d.prescription_id = p.id and d.status = 'confirmed' and dl.item_id = l.item_id), 0)::float dispensed
         from prescription_lines l join prescriptions p on p.id = l.prescription_id where l.prescription_id = $1 order by l.id`, [id])).rows;
    return r;
  };
  app.get("/api/prescriptions", route(pool, "clinical.read", async ({ c, req }) =>
    (await c.query(
      `select p.id, a.name "animalName", p.status, p.source, p.created_at "createdAt", p.approved_at "approvedAt",
              (select count(*)::int from prescription_lines l where l.prescription_id = p.id) "lineCount"
         from prescriptions p join animals a on a.id = p.animal_id where ($1::text is null or p.status = $1)
        order by p.created_at desc limit 200`, [req.query.status ?? null])).rows));
  app.get("/api/prescriptions/:id", route(pool, "clinical.read", ({ c, req }) => rxView(c, uuid.parse(req.params.id))));

  app.post("/api/prescriptions", route(pool, "clinical.write", async ({ c, user, req }) => {
    const b = z.object({ consultationId: uuid, source: z.enum(["manual", "voice"]).default("manual"), lines: z.array(LineBody).min(1, "Add at least one medicine").max(50) }).parse(req.body);
    const cons = (await c.query("select animal_id from consultations where id = $1", [b.consultationId])).rows[0];
    if (!cons) throw notFound("Consultation");
    await ensureOwned(c, "items", b.lines.map(l => l.itemId));
    const p = await c.query("insert into prescriptions (tenant_id, consultation_id, animal_id, source, created_by) values ($1,$2,$3,$4,$5) returning id",
      [user.tenantId, b.consultationId, cons.animal_id, b.source, user.userId]);
    for (const l of b.lines) {
      await c.query(
        `insert into prescription_lines (tenant_id, prescription_id, item_id, drug_text, dose, route, frequency, duration, quantity, unmatched, instructions)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [user.tenantId, p.rows[0].id, l.itemId ?? null, l.drugText, l.dose ?? null, l.route ?? null, l.frequency ?? null, l.duration ?? null, l.quantity ?? null, !l.itemId, l.instructions ?? null]);
    }
    await auditTx(c, user, "prescription.create", "prescription", p.rows[0].id, { source: b.source });
    return rxView(c, p.rows[0].id);
  }, 201));

  app.put("/api/prescriptions/:id/lines", route(pool, "clinical.write", async ({ c, user, req }) => {
    const id = uuid.parse(req.params.id);
    const b = z.object({ lines: z.array(LineBody).min(1).max(50) }).parse(req.body);
    await rxView(c, id);
    await ensureOwned(c, "items", b.lines.map(l => l.itemId));
    try {
      await c.query("delete from prescription_lines where prescription_id = $1", [id]);
      for (const l of b.lines) {
        await c.query(
          `insert into prescription_lines (tenant_id, prescription_id, item_id, drug_text, dose, route, frequency, duration, quantity, unmatched, instructions)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [user.tenantId, id, l.itemId ?? null, l.drugText, l.dose ?? null, l.route ?? null, l.frequency ?? null, l.duration ?? null, l.quantity ?? null, !l.itemId, l.instructions ?? null]);
      }
    } catch (e) {
      if ((e as { hint?: string }).hint === "locked") throw new HttpError(409, "locked", "An approved prescription cannot be edited.");
      throw e;
    }
    await auditTx(c, user, "prescription.edit", "prescription", id);
    return rxView(c, id);
  }));

  // Doctor approval is a hard step: only a role with prescription.approve, and every line needs a matched item.
  app.post("/api/prescriptions/:id/approve", route(pool, "prescription.approve", async ({ c, user, req }) => {
    const id = uuid.parse(req.params.id);
    const rx = await rxView(c, id);
    if (rx.status === "approved") return rx;
    if (rx.status !== "draft") throw new HttpError(409, "invalid", `A ${rx.status} prescription cannot be approved.`);
    const open = rx.lines.filter((l: { unmatched: boolean }) => l.unmatched);
    if (open.length) throw new HttpError(409, "unmatched_lines", `Match or confirm ${open.length} medicine line(s) to the catalogue before approving.`, { lines: open.map((l: { id: string }) => l.id) });
    await c.query("update prescriptions set status='approved', approved_by=$2, approved_at=now() where id=$1 and status='draft'", [id, user.userId]);
    await auditTx(c, user, "prescription.approve", "prescription", id);
    return rxView(c, id);
  }));

  app.post("/api/prescriptions/:id/cancel", route(pool, "clinical.write", async ({ c, user, req }) => {
    const id = uuid.parse(req.params.id);
    const reason = z.object({ reason: z.string().trim().min(3).max(300) }).parse(req.body).reason;
    const r = await c.query("update prescriptions set status='cancelled' where id=$1 and status in ('draft','approved') returning id", [id]);
    if (!r.rowCount) throw notFound("Prescription");
    await auditTx(c, user, "prescription.cancel", "prescription", id, undefined, reason);
    return rxView(c, id);
  }));
}
