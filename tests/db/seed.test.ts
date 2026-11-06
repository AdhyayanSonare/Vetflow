import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { migrate } from "../../server/db/migrate";
import { DEMO_CLINIC, DEMO_PASSWORD, DEMO_USERS, seedDemo } from "../../server/db/seed";
import { startEmbedded, type EmbeddedDb } from "../../scripts/lib/embedded";
import { serve } from "../helpers";

let db: EmbeddedDb;
let admin: pg.Client;
let app: pg.Pool;
let summary: Awaited<ReturnType<typeof seedDemo>>;

beforeAll(async () => {
  db = await startEmbedded({ port: 54340, persistent: false });
  await migrate({ adminUrl: db.adminUrl, appPassword: "local_app_pw" });
  summary = await seedDemo({ adminUrl: db.adminUrl, appUrl: db.appUrl });
  admin = new pg.Client({ connectionString: db.adminUrl });
  await admin.connect();
  app = new pg.Pool({ connectionString: db.appUrl, max: 3 });
}, 180_000);
afterAll(async () => { await app?.end(); await admin?.end(); await db?.stop(); }, 60_000);

const one = async (sql: string) => Number((await admin.query(sql)).rows[0].n);

describe("demo seed", () => {
  it("creates a clearly labelled synthetic clinic with branches, stores and every role", async () => {
    expect((await admin.query("select name from tenants")).rows[0].name).toBe(DEMO_CLINIC);
    expect(DEMO_CLINIC).toMatch(/demo data/);
    expect(await one("select count(*) n from branches")).toBe(2);
    expect(await one("select count(*) n from stores where kind in ('central','branch')")).toBe(3);
    expect((await admin.query("select distinct role from users order by 1")).rows.map(r => r.role)).toEqual(["admin", "inventory_manager", "pharmacist", "vet", "viewer"]);
    expect(summary.users).toBe(DEMO_USERS.length);
  });

  it("fills the catalogue, stock, patients and clinical records", async () => {
    expect(await one("select count(*) n from items")).toBeGreaterThanOrEqual(40);
    expect(await one("select count(*) n from batches")).toBeGreaterThanOrEqual(40);
    expect(await one("select count(*) n from animals")).toBe(8);
    expect(await one("select count(*) n from consultations")).toBe(4);
    expect((await admin.query("select status, count(*)::int n from prescriptions group by 1 order by 1")).rows).toEqual([{ status: "approved", n: 3 }, { status: "draft", n: 1 }]);
    expect(await one("select count(*) n from dispenses where status = 'confirmed'")).toBe(2);
    expect(await one("select count(*) n from open_vials where status = 'open'")).toBe(1);
    expect(await one("select count(*) n from purchase_orders")).toBeGreaterThanOrEqual(2);
  });

  it("shows every interesting state a demo needs: low stock, near expiry, expired, in transit, and a discrepancy", async () => {
    const kinds = (await admin.query("select distinct kind from alerts where resolved_at is null")).rows.map(r => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(["low_stock", "expired", "expiring_30", "transfer_discrepancy"]));
    expect(await one("select count(*) n from transfers where status = 'dispatched'")).toBe(1);
    expect(await one("select count(*) n from transfers where status = 'received'")).toBe(2);
    expect(await one("select count(*) n from stock_balances sb join stores s on s.id = sb.store_id where s.kind = 'transit' and sb.quantity > 0")).toBeGreaterThanOrEqual(1);
  });

  it("leaves the ledger consistent with the balances, and ends with a clean nightly reconciliation", async () => {
    expect(await one("select count(*) n from reconcile_balances((select id from tenants))")).toBe(0);
    expect(await one("select count(*) n from stock_balances where quantity < 0")).toBe(0);
    expect(await one("select count(*) n from stock_ledger")).toBeGreaterThan(80);
  });

  it("every demo account can sign in with the documented password, and the viewer cannot change anything", async () => {
    for (const u of DEMO_USERS) {
      const s = await serve(createApp(app));
      const r = await s.call("POST", "/api/auth/login", { email: u.email, password: DEMO_PASSWORD });
      expect(r.status, u.email).toBe(200);
      if (u.role === "viewer") expect((await s.call("POST", "/api/categories", { name: "X" })).status).toBe(403);
      await s.close();
    }
  });

  it("refuses to seed a database that already has a tenant", async () => {
    await expect(seedDemo({ adminUrl: db.adminUrl, appUrl: db.appUrl })).rejects.toThrow(/already has a tenant/);
  });
});
