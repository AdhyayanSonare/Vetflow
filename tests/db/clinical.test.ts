import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { hashPassword } from "../../server/auth/service";
import { adminUrl, appUrl, createTenant, serve, type Fixture } from "../helpers";

let pool: pg.Pool, admin: pg.Pool, hashed: string;
const PW = "Correct-horse-9";
let n = 0;
const days = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
type Client = Awaited<ReturnType<typeof serve>>;
const open: Client[] = [];

async function mkUser(f: Fixture, role: string) {
  const email = `c${role}${Date.now()}${n++}@clinic.test`;
  const id = (await admin.query(
    "insert into users (tenant_id,email,name,password_hash,role) values ($1,$2,$3,$4,$5) returning id", [f.tenantId, email, role, hashed, role])).rows[0].id;
  return { id: id as string, email };
}
async function as(f: Fixture, role: string) {
  const u = await mkUser(f, role);
  const s = await serve(createApp(pool)); open.push(s);
  expect((await s.call("POST", "/api/auth/login", { email: u.email, password: PW })).status).toBe(200);
  return Object.assign(s, { userId: u.id });
}

/** A tenant with an item that has stock, a vet, a pharmacist and an inventory manager. */
async function world(opts: { controlled?: boolean; expiry?: number; qty?: number } = {}) {
  const f = await createTenant(`Clin${n++}`);
  const vet = await as(f, "vet");
  const pharm = await as(f, "pharmacist");
  const mgr = await as(f, "inventory_manager");
  const sup = (await mgr.call("POST", "/api/suppliers", { name: "Supplier" })).json;
  const item = (await mgr.call("POST", "/api/items", { genericName: `Drug${n++}x`, unit: "tablet", controlled: opts.controlled ?? false })).json;
  const rc = (await mgr.call("POST", "/api/receipts", { supplierId: sup.id, storeId: f.storeId,
    lines: [{ itemId: item.id, batchNo: "B1", expiryDate: days(opts.expiry ?? 300), quantity: opts.qty ?? 50, unitCostPaise: 100 }] })).json;
  await mgr.call("POST", `/api/receipts/${rc.id}/confirm`);
  const animal = (await vet.call("POST", "/api/animals", { name: "Bruno", species: "Dog", breed: "Labrador",
    owner: { name: "Rahul Sharma", phone: "9876500000" } })).json;
  const consult = (await vet.call("POST", "/api/consultations", { animalId: animal.id, complaint: "Vomiting", temperatureF: 102 })).json;
  return { f, vet, pharm, mgr, item, animal, consult };
}
const onHand = async (f: Fixture, itemId: string) =>
  Number((await admin.query("select coalesce(sum(quantity),0) q from stock_balances where tenant_id=$1 and item_id=$2", [f.tenantId, itemId])).rows[0].q);
const ledgerCount = async (f: Fixture, type: string) =>
  Number((await admin.query("select count(*)::int c from stock_ledger where tenant_id=$1 and type=$2", [f.tenantId, type])).rows[0].c);

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: appUrl(), max: 10 });
  admin = new pg.Pool({ connectionString: adminUrl() });
  hashed = await hashPassword(PW);
});
afterAll(async () => { for (const s of open) await s.close(); await pool.end(); await admin.end(); });

describe("the demo path: consult, prescribe, approve, dispense", () => {
  it("an approved prescription changes nothing; a confirmed dispense lowers stock and shows on the prescription", async () => {
    const w = await world();
    const rx = (await w.vet.call("POST", "/api/prescriptions", { consultationId: w.consult.id,
      lines: [{ itemId: w.item.id, drugText: "Carprofen 50 mg", dose: "1 tablet", frequency: "twice daily", duration: "5 days", quantity: 10 }] }));
    expect(rx.status).toBe(201);
    expect(rx.json.status).toBe("draft");
    const ap = await w.vet.call("POST", `/api/prescriptions/${rx.json.id}/approve`);
    expect(ap.status).toBe(200);
    expect(ap.json.status).toBe("approved");
    expect(ap.json.approvedByName).toBe("vet");
    expect(await onHand(w.f, w.item.id)).toBe(50);          // approval alone changes nothing
    expect(await ledgerCount(w.f, "dispense")).toBe(0);

    const d = (await w.pharm.call("POST", "/api/dispenses", { storeId: w.f.storeId, prescriptionId: rx.json.id, lines: [{ itemId: w.item.id, quantity: 4 }] })).json;
    expect(await onHand(w.f, w.item.id)).toBe(50);          // a draft dispense changes nothing either
    const done = await w.pharm.call("POST", `/api/dispenses/${d.id}/confirm`, {});
    expect(done.status).toBe(200);
    expect(done.json.status).toBe("confirmed");
    expect(await onHand(w.f, w.item.id)).toBe(46);
    expect(await ledgerCount(w.f, "dispense")).toBe(1);
    const again = await w.pharm.call("POST", `/api/dispenses/${d.id}/confirm`, {});
    expect(again.status).toBe(200);
    expect(await onHand(w.f, w.item.id)).toBe(46);          // confirming twice deducts once
    expect((await w.vet.call("GET", `/api/prescriptions/${rx.json.id}`)).json.lines[0].dispensed).toBe(4);
    const profile = (await w.vet.call("GET", `/api/animals/${w.animal.id}`)).json;
    expect(profile.consultations).toHaveLength(1);
    expect(profile.prescriptions[0].status).toBe("approved");
  });
});

describe("doctor approval is a hard step", () => {
  it("only a vet or admin can approve; unmatched lines block approval", async () => {
    const w = await world();
    const rx = (await w.vet.call("POST", "/api/prescriptions", { consultationId: w.consult.id,
      lines: [{ itemId: w.item.id, drugText: "A", quantity: 1 }, { drugText: "Something not in the catalogue" }] })).json;
    expect((await w.pharm.call("POST", `/api/prescriptions/${rx.id}/approve`)).status).toBe(403);
    expect((await w.mgr.call("POST", `/api/prescriptions/${rx.id}/approve`)).status).toBe(403);
    const blocked = await w.vet.call("POST", `/api/prescriptions/${rx.id}/approve`);
    expect(blocked.status).toBe(409);
    expect(blocked.json.error.code).toBe("unmatched_lines");
    await w.vet.call("PUT", `/api/prescriptions/${rx.id}/lines`, { lines: [{ itemId: w.item.id, drugText: "A", quantity: 1 }] });
    expect((await w.vet.call("POST", `/api/prescriptions/${rx.id}/approve`)).status).toBe(200);
  });

  it("an approved prescription is frozen, in the API and in the database", async () => {
    const w = await world();
    const rx = (await w.vet.call("POST", "/api/prescriptions", { consultationId: w.consult.id, lines: [{ itemId: w.item.id, drugText: "A", quantity: 2 }] })).json;
    await w.vet.call("POST", `/api/prescriptions/${rx.id}/approve`);
    const edit = await w.vet.call("PUT", `/api/prescriptions/${rx.id}/lines`, { lines: [{ itemId: w.item.id, drugText: "A", quantity: 99 }] });
    expect(edit.status).toBe(409);
    expect(edit.json.error.code).toBe("locked");
    await expect(admin.query("update prescription_lines set quantity = 99 where prescription_id = $1", [rx.id])).rejects.toThrow(/cannot be edited/);
    await expect(admin.query("update prescriptions set status = 'draft' where id = $1", [rx.id])).rejects.toThrow(/cannot be changed/);
  });

  it("a viewer cannot create consultations; a completed consultation cannot be edited", async () => {
    const w = await world();
    const viewer = await as(w.f, "viewer");
    expect((await viewer.call("POST", "/api/consultations", { animalId: w.animal.id })).status).toBe(403);
    expect((await viewer.call("GET", "/api/animals")).status).toBe(200);
    await w.vet.call("POST", `/api/consultations/${w.consult.id}/complete`);
    expect((await w.vet.call("PATCH", `/api/consultations/${w.consult.id}`, { diagnosis: "x" })).status).toBe(409);
  });
});

describe("dispensing rules", () => {
  it("cannot dispense a draft prescription, an item that is not on it, or more than prescribed", async () => {
    const w = await world();
    const other = (await w.mgr.call("POST", "/api/items", { genericName: "Zzzunrelated", unit: "ml" })).json;
    const rx = (await w.vet.call("POST", "/api/prescriptions", { consultationId: w.consult.id, lines: [{ itemId: w.item.id, drugText: "A", quantity: 5 }] })).json;
    const body = { storeId: w.f.storeId, prescriptionId: rx.id, lines: [{ itemId: w.item.id, quantity: 1 }] };
    expect((await w.pharm.call("POST", "/api/dispenses", body)).json.error.code).toBe("not_approved");
    await w.vet.call("POST", `/api/prescriptions/${rx.id}/approve`);
    const wrongItem = (await w.pharm.call("POST", "/api/dispenses", { ...body, lines: [{ itemId: other.id, quantity: 1 }] })).json;
    expect((await w.pharm.call("POST", `/api/dispenses/${wrongItem.id}/confirm`, {})).json.error.code).toBe("not_prescribed");
    const big = (await w.pharm.call("POST", "/api/dispenses", { ...body, lines: [{ itemId: w.item.id, quantity: 6 }] })).json;
    expect((await w.pharm.call("POST", `/api/dispenses/${big.id}/confirm`, {})).json.error.code).toBe("over_prescribed");
    expect(await onHand(w.f, w.item.id)).toBe(50);
  });

  it("a multi-line dispense is all or nothing when one line lacks stock", async () => {
    const w = await world({ qty: 10 });
    const empty = (await w.mgr.call("POST", "/api/items", { genericName: "Emptyitem", unit: "ml" })).json;
    const d = (await w.mgr.call("POST", "/api/dispenses", { storeId: w.f.storeId, counterReason: "Walk-in purchase",
      lines: [{ itemId: w.item.id, quantity: 3 }, { itemId: empty.id, quantity: 1 }] })).json;
    const r = await w.mgr.call("POST", `/api/dispenses/${d.id}/confirm`, {});
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("insufficient");
    expect(await onHand(w.f, w.item.id)).toBe(10);
    expect(await ledgerCount(w.f, "dispense")).toBe(0);
    expect((await w.mgr.call("GET", `/api/dispenses/${d.id}`)).json.status).toBe("draft");
  });

  it("expired stock cannot be dispensed", async () => {
    const w = await world({ expiry: -5 });
    const d = (await w.mgr.call("POST", "/api/dispenses", { storeId: w.f.storeId, counterReason: "Walk-in purchase", lines: [{ itemId: w.item.id, quantity: 1 }] })).json;
    expect((await w.mgr.call("POST", `/api/dispenses/${d.id}/confirm`, {})).status).toBe(409);
    expect(await onHand(w.f, w.item.id)).toBe(50);
  });

  it("a counter sale needs a reason and an authorised role", async () => {
    const w = await world();
    const body = { storeId: w.f.storeId, lines: [{ itemId: w.item.id, quantity: 1 }] };
    expect((await w.pharm.call("POST", "/api/dispenses", { ...body, counterReason: "Walk-in purchase" })).status).toBe(403);
    expect((await w.mgr.call("POST", "/api/dispenses", body)).status).toBe(400);
    expect((await w.mgr.call("POST", "/api/dispenses", { ...body, counterReason: "Walk-in purchase" })).status).toBe(201);
  });

  it("a controlled medicine needs a different second user with a valid password", async () => {
    const w = await world({ controlled: true });
    const d = (await w.mgr.call("POST", "/api/dispenses", { storeId: w.f.storeId, counterReason: "Emergency sedation", lines: [{ itemId: w.item.id, quantity: 2 }] })).json;
    const path = `/api/dispenses/${d.id}/confirm`;
    expect((await w.mgr.call("POST", path, {})).json.error.code).toBe("witness_required");
    expect((await w.mgr.call("POST", path, { witnessUserId: w.mgr.userId, witnessPassword: PW })).json.error.code).toBe("witness_same_user");
    const second = await mkUser(w.f, "pharmacist");
    expect((await w.mgr.call("POST", path, { witnessUserId: second.id, witnessPassword: "wrong" })).json.error.code).toBe("witness_invalid");
    const viewer = await mkUser(w.f, "viewer");
    expect((await w.mgr.call("POST", path, { witnessUserId: viewer.id, witnessPassword: PW })).json.error.code).toBe("witness_invalid");
    expect(await onHand(w.f, w.item.id)).toBe(50);
    expect((await w.mgr.call("POST", path, { witnessUserId: second.id, witnessPassword: PW })).status).toBe(200);
    expect(await onHand(w.f, w.item.id)).toBe(48);
    const a = await admin.query("select count(*)::int n from audit_log where tenant_id=$1 and action='dispense.witness'", [w.f.tenantId]);
    expect(a.rows[0].n).toBe(1);
  });
});

describe("voice and transcripts only create drafts", () => {
  it("storing a transcript changes no prescription and no stock", async () => {
    const w = await world();
    const before = await onHand(w.f, w.item.id);
    const r = await w.vet.call("POST", `/api/consultations/${w.consult.id}/transcripts`, { language: "en", provider: "canary", text: "Give carprofen fifty milligrams twice daily" });
    expect(r.status).toBe(201);
    expect((await w.vet.call("GET", "/api/prescriptions")).json).toEqual([]);
    expect(await onHand(w.f, w.item.id)).toBe(before);
    expect((await w.vet.call("GET", `/api/consultations/${w.consult.id}`)).json.transcripts).toHaveLength(1);
  });
});

describe("tenant isolation in clinical routes", () => {
  it("another tenant cannot read or use this tenant's patients, consultations, prescriptions or dispenses", async () => {
    const a = await world();
    const rx = (await a.vet.call("POST", "/api/prescriptions", { consultationId: a.consult.id, lines: [{ itemId: a.item.id, drugText: "A", quantity: 3 }] })).json;
    await a.vet.call("POST", `/api/prescriptions/${rx.id}/approve`);
    const d = (await a.pharm.call("POST", "/api/dispenses", { storeId: a.f.storeId, prescriptionId: rx.id, lines: [{ itemId: a.item.id, quantity: 1 }] })).json;

    const b = await world();
    for (const path of ["/api/animals", "/api/consultations", "/api/prescriptions", "/api/dispenses"]) {
      expect(JSON.stringify((await b.pharm.call("GET", path)).json), path).not.toContain(a.animal.id);
    }
    expect((await b.vet.call("GET", `/api/animals/${a.animal.id}`)).status).toBe(404);
    expect((await b.vet.call("GET", `/api/consultations/${a.consult.id}`)).status).toBe(404);
    expect((await b.vet.call("GET", `/api/prescriptions/${rx.id}`)).status).toBe(404);
    expect((await b.vet.call("POST", `/api/prescriptions/${rx.id}/cancel`, { reason: "attack" })).status).toBe(404);
    expect((await b.pharm.call("GET", `/api/dispenses/${d.id}`)).status).toBe(404);
    expect((await b.pharm.call("POST", `/api/dispenses/${d.id}/confirm`, {})).status).toBe(404);
    expect((await b.vet.call("POST", "/api/consultations", { animalId: a.animal.id })).status).toBe(404);
    expect((await b.vet.call("POST", "/api/prescriptions", { consultationId: a.consult.id, lines: [{ drugText: "x" }] })).status).toBe(404);
    expect((await b.pharm.call("POST", "/api/dispenses", { storeId: b.f.storeId, prescriptionId: rx.id, lines: [{ itemId: b.item.id, quantity: 1 }] })).status).toBe(404);
    expect(await onHand(a.f, a.item.id)).toBe(50);
  });
});
