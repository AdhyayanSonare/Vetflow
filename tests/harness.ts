import pg from "pg";
import { expect } from "vitest";
import { createApp } from "../server/app";
import { hashPassword } from "../server/modules/auth/service";
import { adminUrl, appUrl, createTenant, serve, type Fixture } from "./helpers";

export const PW = "Correct-horse-9";
/** Calendar date in India, d days from today. */
export const days = (d: number) => new Date(Date.now() + 5.5 * 3600000 + d * 86400000).toISOString().slice(0, 10);

export type Signed = Awaited<ReturnType<typeof serve>> & { userId: string };

/** Shared set-up for API tests: pools, signed-in clients by role, and stocked tenants. */
export function harness() {
  let pool: pg.Pool, admin: pg.Pool, hashed = "", n = 0;
  const open: Array<{ close: () => Promise<void> }> = [];

  async function init() {
    pool = new pg.Pool({ connectionString: appUrl(), max: 10 });
    admin = new pg.Pool({ connectionString: adminUrl() });
    hashed = await hashPassword(PW);
    return { pool, admin };
  }
  async function done() { for (const s of open) await s.close(); await pool.end(); await admin.end(); }

  async function mkUser(f: Fixture, role: string) {
    const email = `h${role}${Date.now()}${n++}@clinic.test`;
    const id = (await admin.query(
      "insert into users (tenant_id,email,name,password_hash,role) values ($1,$2,$3,$4,$5) returning id", [f.tenantId, email, role, hashed, role])).rows[0].id;
    return { id: id as string, email };
  }
  async function as(f: Fixture, role: string): Promise<Signed> {
    const u = await mkUser(f, role);
    const s = await serve(createApp(pool)); open.push(s);
    expect((await s.call("POST", "/api/auth/login", { email: u.email, password: PW })).status).toBe(200);
    return Object.assign(s, { userId: u.id });
  }

  /** A tenant with a manager, a pharmacist, a vet, a second store, and one item with stock in the central store. */
  async function stocked(opts: { qty?: number; expiry?: number; multiDose?: boolean } = {}) {
    const f = await createTenant(`H${n++}`);
    const mgr = await as(f, "inventory_manager");
    const pharm = await as(f, "pharmacist");
    const vet = await as(f, "vet");
    const store2 = (await admin.query("insert into stores (tenant_id, branch_id, kind, name) values ($1,$2,'branch','Branch store') returning id", [f.tenantId, f.branchId])).rows[0].id as string;
    const sup = (await mgr.call("POST", "/api/suppliers", { name: "Supplier" })).json;
    const item = (await mgr.call("POST", "/api/items", { genericName: `Thing${n++}q`, unit: opts.multiDose ? "vial" : "tablet",
      multiDose: opts.multiDose ?? false, doseVolumeMl: opts.multiDose ? 10 : undefined, beyondUseDays: opts.multiDose ? 28 : undefined })).json;
    const rc = (await mgr.call("POST", "/api/receipts", { supplierId: sup.id, storeId: f.storeId,
      lines: [{ itemId: item.id, batchNo: "B1", expiryDate: days(opts.expiry ?? 300), quantity: opts.qty ?? 50, unitCostPaise: 100 }] })).json;
    await mgr.call("POST", `/api/receipts/${rc.id}/confirm`);
    return { f, mgr, pharm, vet, item, store2, sup };
  }

  const balance = async (itemId: string, storeId: string) =>
    Number((await admin.query("select coalesce(sum(quantity),0) q from stock_balances where item_id=$1 and store_id=$2", [itemId, storeId])).rows[0].q);
  const total = async (itemId: string) =>
    Number((await admin.query("select coalesce(sum(quantity),0) q from stock_balances where item_id=$1", [itemId])).rows[0].q);
  const ledgerTypes = async (itemId: string) =>
    (await admin.query("select distinct type from stock_ledger where item_id=$1 order by type", [itemId])).rows.map(r => r.type as string);

  return { init, done, mkUser, as, stocked, balance, total, ledgerTypes, get admin() { return admin; }, get pool() { return pool; } };
}
