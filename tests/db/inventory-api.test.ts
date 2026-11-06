import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { hashPassword } from "../../server/auth/service";
import { adminUrl, appUrl, createTenant, serve, type Fixture } from "../helpers";

let pool: pg.Pool, admin: pg.Pool;
let hashed: string;
const PW = "Correct-horse-9";
let n = 0;
const days = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

type Client = Awaited<ReturnType<typeof serve>>;
const open: Client[] = [];

/** A signed-in client for a user with the given role in the given tenant. */
async function as(f: Fixture, role: string) {
  const email = `r${role}${Date.now()}${n++}@clinic.test`;
  await admin.query(
    "insert into users (tenant_id,email,name,password_hash,role) values ($1,$2,$3,$4,$5)", [f.tenantId, email, role, hashed, role]);
  const s = await serve(createApp(pool));
  open.push(s);
  const r = await s.call("POST", "/api/auth/login", { email, password: PW });
  expect(r.status).toBe(200);
  return s;
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: appUrl(), max: 8 });
  admin = new pg.Pool({ connectionString: adminUrl() });
  hashed = await hashPassword(PW);
});
afterAll(async () => { for (const s of open) await s.close(); await pool.end(); await admin.end(); });

describe("catalogue", () => {
  it("creates an item without a barcode and lists it", async () => {
    const f = await createTenant("Cat1");
    const s = await as(f, "inventory_manager");
    const r = await s.call("POST", "/api/items", { genericName: "Meloxicam", strength: "1.5 mg/ml", unit: "ml", minQty: 5 });
    expect(r.status).toBe(201);
    expect(r.json.barcode).toBeNull();
    expect(r.json.code).toMatch(/^ITM-\d{6}$/);
    const list = await s.call("GET", "/api/items?q=meloxi");
    expect(list.json.map((i: { genericName: string }) => i.genericName)).toContain("Meloxicam");
  });

  it("warns about similar names and an exact duplicate, and accepts a confirmed one", async () => {
    const f = await createTenant("Cat2");
    const s = await as(f, "inventory_manager");
    expect((await s.call("POST", "/api/items", { genericName: "Cefalexin", strength: "500 mg", unit: "tablet" })).status).toBe(201);
    const exact = await s.call("POST", "/api/items", { genericName: "Cefalexin", strength: "500 mg", unit: "tablet" });
    expect(exact.status).toBe(409);
    expect(exact.json.error.code).toBe("similar_items");
    expect(exact.json.error.exact).toBe(true);
    const near = await s.call("POST", "/api/items", { genericName: "Cefalexine", strength: "250 mg", unit: "tablet" });
    expect(near.status).toBe(409);
    expect(near.json.error.similar.length).toBeGreaterThan(0);
    const ok = await s.call("POST", "/api/items", { genericName: "Cefalexine", strength: "250 mg", unit: "tablet", confirmSimilar: true });
    expect(ok.status).toBe(201);
  });

  it("rejects a duplicate barcode and a multi-dose item with no volume", async () => {
    const f = await createTenant("Cat3");
    const s = await as(f, "inventory_manager");
    await s.call("POST", "/api/items", { genericName: "Syringe 5 ml", unit: "box", barcode: "8901234567890" });
    expect((await s.call("POST", "/api/items", { genericName: "Bandage roll", unit: "box", barcode: "8901234567890" })).json.error.code).toBe("duplicate_barcode");
    expect((await s.call("POST", "/api/items", { genericName: "Vial X", unit: "vial", multiDose: true })).status).toBe(400);
  });

  it("PATCH changes only the fields sent and never resets the others to defaults", async () => {
    const f = await createTenant("Cat5");
    const s = await as(f, "inventory_manager");
    const it = (await s.call("POST", "/api/items", { genericName: "Ketamine", unit: "vial", multiDose: true, doseVolumeMl: 10,
      controlled: true, minQty: 3, reorderQty: 12 })).json;
    const r = await s.call("PATCH", `/api/items/${it.id}`, { storageLocation: "Safe 1" });
    expect(r.json).toMatchObject({ controlled: true, multiDose: true, doseVolumeMl: 10, minQty: 3, reorderQty: 12, active: true, storageLocation: "Safe 1" });
  });

  it("validates input with a readable message", async () => {
    const f = await createTenant("Cat4");
    const s = await as(f, "inventory_manager");
    const r = await s.call("POST", "/api/items", { genericName: "", unit: "tablet" });
    expect(r.status).toBe(400);
    expect(r.json.error.message).toMatch(/genericName/);
  });
});

describe("permissions", () => {
  it("a viewer and a pharmacist cannot adjust stock; a viewer cannot create items; no session gets 401", async () => {
    const f = await createTenant("Perm1");
    const body = { type: "damage", itemId: f.itemId, batchId: f.itemId, storeId: f.storeId, quantity: 1, reason: "broken" };
    const viewer = await as(f, "viewer");
    const pharm = await as(f, "pharmacist");
    expect((await viewer.call("POST", "/api/stock/adjust", body)).status).toBe(403);
    expect((await pharm.call("POST", "/api/stock/adjust", body)).status).toBe(403);
    expect((await viewer.call("POST", "/api/items", { genericName: "X", unit: "u" })).status).toBe(403);
    const anon = await serve(createApp(pool)); open.push(anon);
    expect((await anon.call("GET", "/api/items")).status).toBe(401);
  });
});

describe("purchasing, stock, low stock, expiry", () => {
  it("draft receipt leaves stock unchanged; confirm adds it once; stock, low-stock and expiry views agree", async () => {
    const f = await createTenant("Buy1");
    const s = await as(f, "inventory_manager");
    const sup = (await s.call("POST", "/api/suppliers", { name: "Vet Distributors", gstin: "27ABCDE1234F1Z5" })).json;
    const item = (await s.call("POST", "/api/items", { genericName: "Carprofen", unit: "tablet", minQty: 20, reorderQty: 100 })).json;
    const draft = await s.call("POST", "/api/receipts", {
      supplierId: sup.id, storeId: f.storeId, invoiceNo: "INV-1",
      lines: [
        { itemId: item.id, batchNo: "NEAR", expiryDate: days(20), quantity: 10, unitCostPaise: 1200 },
        { itemId: item.id, batchNo: "FAR", expiryDate: days(400), quantity: 30, unitCostPaise: 1300 },
      ],
    });
    expect(draft.status).toBe(201);
    expect(draft.json.status).toBe("draft");
    expect((await s.call("GET", "/api/stock")).json).toEqual([]);

    const done = await s.call("POST", `/api/receipts/${draft.json.id}/confirm`);
    expect(done.status).toBe(200);
    expect(done.json.status).toBe("confirmed");
    await s.call("POST", `/api/receipts/${draft.json.id}/confirm`);
    const stock = (await s.call("GET", "/api/stock")).json;
    expect(stock.map((r: { batchNo: string; quantity: number }) => [r.batchNo, r.quantity]).sort()).toEqual([["FAR", 30], ["NEAR", 10]]);

    expect((await s.call("GET", "/api/items?q=carpro")).json[0].onHand).toBe(40);
    expect((await s.call("GET", "/api/low-stock")).json).toEqual([]);
    const exp = (await s.call("GET", "/api/expiring?days=30")).json;
    expect(exp.map((e: { batchNo: string }) => e.batchNo)).toEqual(["NEAR"]);

    await s.call("PATCH", `/api/items/${item.id}`, { minQty: 40 });
    const low = (await s.call("GET", "/api/low-stock")).json;
    expect(low).toHaveLength(1);
    expect(low[0]).toMatchObject({ onHand: 40, minQty: 40, suggestedReorder: 100 });

    const sug = (await s.call("GET", `/api/stock/suggest?itemId=${item.id}&storeId=${f.storeId}&quantity=12`)).json;
    expect(sug.map((a: { batchNo: string; take: string }) => [a.batchNo, a.take])).toEqual([["NEAR", "10.000"], ["FAR", "2.000"]]);
  });

  it("rejects a receipt with no lines or a bad date", async () => {
    const f = await createTenant("Buy2");
    const s = await as(f, "inventory_manager");
    expect((await s.call("POST", "/api/receipts", { supplierId: f.itemId, storeId: f.storeId, lines: [] })).status).toBe(400);
  });

  it("adjustment needs a reason, is allowed for an inventory manager, and shows user and reason in the ledger", async () => {
    const f = await createTenant("Adj1");
    const s = await as(f, "inventory_manager");
    const sup = (await s.call("POST", "/api/suppliers", { name: "S" })).json;
    const item = (await s.call("POST", "/api/items", { genericName: "Gauze", unit: "pack" })).json;
    const rc = (await s.call("POST", "/api/receipts", { supplierId: sup.id, storeId: f.storeId,
      lines: [{ itemId: item.id, batchNo: "G1", expiryDate: days(300), quantity: 10, unitCostPaise: 500 }] })).json;
    await s.call("POST", `/api/receipts/${rc.id}/confirm`);
    const st = (await s.call("GET", "/api/stock")).json[0];
    const base = { itemId: item.id, batchId: st.batchId, storeId: f.storeId, quantity: 2, type: "damage" };
    expect((await s.call("POST", "/api/stock/adjust", { ...base, reason: "" })).status).toBe(400);
    expect((await s.call("POST", "/api/stock/adjust", { ...base, reason: "dropped in store" })).status).toBe(201);
    expect((await s.call("POST", "/api/stock/adjust", { ...base, quantity: 50, reason: "too many" })).status).toBe(409);
    const led = (await s.call("GET", "/api/ledger")).json;
    expect(led[0]).toMatchObject({ type: "damage", reason: "dropped in store", userName: "inventory_manager" });
    expect(led.map((l: { type: string }) => l.type)).toContain("receipt");
  });
});

describe("tenant isolation across the API", () => {
  it("another tenant cannot read, change or reference this tenant's data", async () => {
    const a = await createTenant("IsoApiA");
    const b = await createTenant("IsoApiB");
    const sa = await as(a, "admin");
    const sb = await as(b, "admin");
    const sup = (await sa.call("POST", "/api/suppliers", { name: "A supplier" })).json;
    const item = (await sa.call("POST", "/api/items", { genericName: "Secret drug", unit: "ml" })).json;
    const rc = (await sa.call("POST", "/api/receipts", { supplierId: sup.id, storeId: a.storeId,
      lines: [{ itemId: item.id, batchNo: "S1", expiryDate: days(300), quantity: 5, unitCostPaise: 100 }] })).json;
    await sa.call("POST", `/api/receipts/${rc.id}/confirm`);
    const batch = (await sa.call("GET", "/api/stock")).json[0];

    // Lists never include the other tenant's rows.
    for (const path of ["/api/items", "/api/suppliers", "/api/stock", "/api/receipts", "/api/ledger", "/api/expiring", "/api/low-stock", "/api/stores", "/api/branches"]) {
      const r = await sb.call("GET", path);
      expect(JSON.stringify(r.json), path).not.toMatch(/Secret drug|A supplier|IsoApiA/);
    }
    // Id-based reads and writes return not found.
    expect((await sb.call("GET", `/api/items/${item.id}`)).status).toBe(404);
    expect((await sb.call("PATCH", `/api/items/${item.id}`, { genericName: "Hacked" })).status).toBe(404);
    expect((await sb.call("PATCH", `/api/suppliers/${sup.id}`, { name: "Hacked" })).status).toBe(404);
    expect((await sb.call("GET", `/api/receipts/${rc.id}`)).status).toBe(404);
    expect((await sb.call("POST", `/api/receipts/${rc.id}/confirm`)).status).toBe(404);
    // Referencing another tenant's ids in a body is refused.
    const mine = (await sb.call("POST", "/api/suppliers", { name: "B supplier" })).json;
    const refSup = await sb.call("POST", "/api/receipts", { supplierId: sup.id, storeId: b.storeId,
      lines: [{ itemId: (await sb.call("POST", "/api/items", { genericName: "B item", unit: "u" })).json.id, batchNo: "X", expiryDate: days(100), quantity: 1, unitCostPaise: 1 }] });
    expect(refSup.status).toBe(404);
    const refItem = await sb.call("POST", "/api/receipts", { supplierId: mine.id, storeId: b.storeId,
      lines: [{ itemId: item.id, batchNo: "X", expiryDate: days(100), quantity: 1, unitCostPaise: 1 }] });
    expect(refItem.status).toBe(404);
    const refStore = await sb.call("POST", "/api/receipts", { supplierId: mine.id, storeId: a.storeId,
      lines: [{ itemId: item.id, batchNo: "X", expiryDate: days(100), quantity: 1, unitCostPaise: 1 }] });
    expect(refStore.status).toBe(404);
    const adj = await sb.call("POST", "/api/stock/adjust", { type: "damage", itemId: item.id, batchId: batch.batchId, storeId: a.storeId, quantity: 1, reason: "attack" });
    expect(adj.status).toBe(404);
    expect((await sb.call("GET", `/api/stock/suggest?itemId=${item.id}&storeId=${a.storeId}&quantity=1`)).status).not.toBe(200);
    // And nothing changed for tenant A.
    expect((await sa.call("GET", "/api/stock")).json[0].quantity).toBe(5);
  });
});
