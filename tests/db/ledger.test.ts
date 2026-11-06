import fc from "fast-check";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../../server/db/pool";
import { confirmReceipt, issueFefo, postMovement, reconcile, StockError, suggestFefo, transferStock } from "../../server/modules/stock/ledger";
import { adminUrl, appUrl, createTenant, type Fixture } from "../helpers";

let pool: pg.Pool, admin: pg.Pool;
beforeAll(() => {
  pool = new pg.Pool({ connectionString: appUrl(), max: 8 });
  admin = new pg.Pool({ connectionString: adminUrl() });
});
afterAll(async () => { await pool.end(); await admin.end(); });

let seq = 0;
const key = () => `k${Date.now()}-${seq++}`;
const days = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function newBatch(f: Fixture, expiry = days(200), cost = 1000) {
  return (await admin.query(
    "insert into batches (tenant_id,item_id,batch_no,expiry_date,unit_cost_paise) values ($1,$2,$3,$4,$5) returning id",
    [f.tenantId, f.itemId, `B${seq++}`, expiry, cost])).rows[0].id as string;
}
async function newStore(f: Fixture, name: string) {
  return (await admin.query(
    "insert into stores (tenant_id, branch_id, kind, name) values ($1,$2,'branch',$3) returning id",
    [f.tenantId, f.branchId, `${name}-${seq++}`])).rows[0].id as string;
}
const qty = async (batch: string, store: string) =>
  Number((await admin.query(
    "select coalesce(sum(quantity),0) q from stock_balances where batch_id=$1 and store_id=$2", [batch, store])).rows[0].q);
const mv = (f: Fixture, o: Partial<Parameters<typeof postMovement>[1]> & { batchId: string }) =>
  withTenant(f.tenantId, c => postMovement(c, {
    tenantId: f.tenantId, type: "receipt", itemId: f.itemId, quantity: 1, userId: f.userId, idempotencyKey: key(), ...o,
  }), pool);

describe("acceptance: receipts", () => {
  it("draft receipt leaves stock unchanged; confirmed receipt adds the received quantity exactly once", async () => {
    const f = await createTenant("Rcpt");
    const sup = (await admin.query("insert into suppliers (tenant_id,name) values ($1,'S') returning id", [f.tenantId])).rows[0].id;
    const rc = (await admin.query(
      "insert into purchase_receipts (tenant_id,supplier_id,store_id) values ($1,$2,$3) returning id",
      [f.tenantId, sup, f.storeId])).rows[0].id;
    await admin.query(
      "insert into receipt_lines (tenant_id,receipt_id,item_id,batch_no,expiry_date,quantity,unit_cost_paise) values ($1,$2,$3,'X1',$4,25,500)",
      [f.tenantId, rc, f.itemId, days(300)]);
    const total = async () => Number((await admin.query(
      "select coalesce(sum(quantity),0) q from stock_balances where tenant_id=$1", [f.tenantId])).rows[0].q);
    expect(await total()).toBe(0);
    await withTenant(f.tenantId, c => confirmReceipt(c, f.tenantId, rc, f.userId), pool);
    expect(await total()).toBe(25);
    const again = await withTenant(f.tenantId, c => confirmReceipt(c, f.tenantId, rc, f.userId), pool);
    expect(again.alreadyConfirmed).toBe(true);
    expect(await total()).toBe(25);
  });
});

describe("acceptance: dispense, transfer, batches, expiry", () => {
  it("dispense lowers the right balance and writes a ledger row", async () => {
    const f = await createTenant("Disp");
    const b = await newBatch(f);
    await mv(f, { batchId: b, quantity: 10, toStoreId: f.storeId });
    await mv(f, { batchId: b, type: "dispense", quantity: 3, fromStoreId: f.storeId });
    expect(await qty(b, f.storeId)).toBe(7);
    const rows = (await admin.query("select type,user_id from stock_ledger where batch_id=$1 order by id", [b])).rows;
    expect(rows.map(r => r.type)).toEqual(["receipt", "dispense"]);
    expect(rows.every(r => r.user_id === f.userId)).toBe(true);
  });

  it("transfer moves stock without writing any consumption row", async () => {
    const f = await createTenant("Xfer");
    const b = await newBatch(f);
    const s2 = await newStore(f, "branch2");
    await mv(f, { batchId: b, quantity: 10, toStoreId: f.storeId });
    await withTenant(f.tenantId, c => transferStock(c, {
      tenantId: f.tenantId, itemId: f.itemId, batchId: b, quantity: 4,
      fromStoreId: f.storeId, toStoreId: s2, userId: f.userId, reference: "t1", idempotencyKey: key(),
    }), pool);
    expect(await qty(b, f.storeId)).toBe(6);
    expect(await qty(b, s2)).toBe(4);
    const types = (await admin.query("select distinct type from stock_ledger where batch_id=$1", [b])).rows.map(r => r.type);
    expect(types.sort()).toEqual(["receipt", "transfer_in", "transfer_out"]);
  });

  it("batches keep independent quantity and expiry, and FEFO draws the earliest first", async () => {
    const f = await createTenant("Fefo");
    const early = await newBatch(f, days(40));
    const late = await newBatch(f, days(400));
    await mv(f, { batchId: late, quantity: 10, toStoreId: f.storeId });
    await mv(f, { batchId: early, quantity: 5, toStoreId: f.storeId });
    const plan = await withTenant(f.tenantId, c => suggestFefo(c, f.itemId, f.storeId, 8), pool);
    expect(plan.map(p => [p.batchId, p.take])).toEqual([[early, "5.000"], [late, "3.000"]]);
    await withTenant(f.tenantId, c => issueFefo(c, {
      tenantId: f.tenantId, type: "issue", itemId: f.itemId, storeId: f.storeId,
      quantity: 8, userId: f.userId, reference: "r", idempotencyKey: key(),
    }), pool);
    expect(await qty(early, f.storeId)).toBe(0);
    expect(await qty(late, f.storeId)).toBe(7);
  });

  it("expired stock cannot be issued or dispensed, but can be written off", async () => {
    const f = await createTenant("Exp");
    const b = await newBatch(f, days(-1));
    await mv(f, { batchId: b, quantity: 5, toStoreId: f.storeId });
    for (const type of ["issue", "dispense", "transfer_out"] as const) {
      await expect(mv(f, { batchId: b, type, fromStoreId: f.storeId })).rejects.toMatchObject({ code: "expired" });
    }
    await expect(withTenant(f.tenantId, c => suggestFefo(c, f.itemId, f.storeId, 1), pool)).rejects.toBeInstanceOf(StockError);
    await mv(f, { batchId: b, type: "expiry_writeoff", fromStoreId: f.storeId, quantity: 5, reason: "expired" });
    expect(await qty(b, f.storeId)).toBe(0);
  });
});

describe("negative stock and overrides", () => {
  it("blocks negative stock", async () => {
    const f = await createTenant("Neg");
    const b = await newBatch(f);
    await mv(f, { batchId: b, quantity: 2, toStoreId: f.storeId });
    await expect(mv(f, { batchId: b, type: "issue", quantity: 3, fromStoreId: f.storeId })).rejects.toMatchObject({ code: "insufficient" });
    expect(await qty(b, f.storeId)).toBe(2);
  });

  it("override needs tenant setting, an allowed role and a reason, and writes an audit row", async () => {
    const f = await createTenant("Ovr");
    const b = await newBatch(f);
    const ov = { batchId: b, type: "issue" as const, quantity: 3, fromStoreId: f.storeId, override: true, reason: "count error" };
    await expect(mv(f, ov)).rejects.toMatchObject({ code: "forbidden" });
    await admin.query("update tenant_settings set allow_negative_override=true where tenant_id=$1", [f.tenantId]);
    await expect(mv(f, { ...ov, reason: "" })).rejects.toBeInstanceOf(StockError);
    await admin.query("update users set role='viewer' where id=$1", [f.userId]);
    await expect(mv(f, ov)).rejects.toMatchObject({ code: "forbidden" });
    await admin.query("update users set role='inventory_manager' where id=$1", [f.userId]);
    await mv(f, ov);
    expect(await qty(b, f.storeId)).toBe(-3);
    const a = await admin.query(
      "select count(*)::int n from audit_log where tenant_id=$1 and action='stock.override'", [f.tenantId]);
    expect(a.rows[0].n).toBe(1);
  });

  it("the app role cannot write balances directly", async () => {
    const f = await createTenant("Perm");
    const b = await newBatch(f);
    await expect(withTenant(f.tenantId, c => c.query("update stock_balances set quantity=999"), pool)).rejects.toThrow(/permission denied/);
    await expect(withTenant(f.tenantId, c => c.query(
      "insert into stock_balances (tenant_id,item_id,batch_id,store_id,quantity) values ($1,$2,$3,$4,5)",
      [f.tenantId, f.itemId, b, f.storeId]), pool)).rejects.toThrow(/permission denied/);
  });
});

describe("tenant isolation inside the stock function", () => {
  it("rejects another tenant's batch, store and a mismatched tenant argument", async () => {
    const a = await createTenant("IsoA");
    const o = await createTenant("IsoB");
    const ob = await newBatch(o);
    await expect(mv(a, { batchId: ob, toStoreId: a.storeId })).rejects.toBeInstanceOf(StockError);
    const ab = await newBatch(a);
    await expect(mv(a, { batchId: ab, toStoreId: o.storeId })).rejects.toBeInstanceOf(StockError);
    await expect(withTenant(a.tenantId, c => postMovement(c, {
      tenantId: o.tenantId, type: "receipt", itemId: o.itemId, batchId: ob, quantity: 1, toStoreId: o.storeId, idempotencyKey: key(),
    }), pool)).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("idempotency and concurrency", () => {
  it("replaying an idempotency key changes nothing", async () => {
    const f = await createTenant("Idem");
    const b = await newBatch(f);
    const k = key();
    const id1 = await mv(f, { batchId: b, quantity: 5, toStoreId: f.storeId, idempotencyKey: k });
    const id2 = await mv(f, { batchId: b, quantity: 5, toStoreId: f.storeId, idempotencyKey: k });
    expect(id2).toBe(id1);
    expect(await qty(b, f.storeId)).toBe(5);
  });

  it("simultaneous issues of the last unit: exactly one succeeds", async () => {
    const f = await createTenant("Race");
    const b = await newBatch(f);
    await mv(f, { batchId: b, quantity: 1, toStoreId: f.storeId });
    const results = await Promise.allSettled(Array.from({ length: 6 }, () =>
      mv(f, { batchId: b, type: "issue", quantity: 1, fromStoreId: f.storeId })));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await qty(b, f.storeId)).toBe(0);
  });

  it("the same key sent concurrently is applied once", async () => {
    const f = await createTenant("RaceKey");
    const b = await newBatch(f);
    const k = key();
    await Promise.all(Array.from({ length: 5 }, () => mv(f, { batchId: b, quantity: 2, toStoreId: f.storeId, idempotencyKey: k })));
    expect(await qty(b, f.storeId)).toBe(2);
  });

  it("a failed multi-row write leaves no partial rows", async () => {
    const f = await createTenant("Atomic");
    const b = await newBatch(f);
    await mv(f, { batchId: b, quantity: 4, toStoreId: f.storeId });
    const issue = (c: pg.PoolClient) => postMovement(c, {
      tenantId: f.tenantId, type: "issue", itemId: f.itemId, batchId: b, quantity: 3, fromStoreId: f.storeId, idempotencyKey: key(),
    });
    await expect(withTenant(f.tenantId, async c => { await issue(c); await issue(c); }, pool)).rejects.toBeInstanceOf(StockError);
    expect(await qty(b, f.storeId)).toBe(4);
  });
});

describe("property: ledger always equals balances", () => {
  it("random operation sequences keep balances equal to the ledger and never negative", async () => {
    const opArb = fc.record({
      kind: fc.constantFrom("receipt", "issue", "dispense", "transfer", "damage", "replay"),
      batch: fc.integer({ min: 0, max: 1 }),
      store: fc.integer({ min: 0, max: 1 }),
      q: fc.integer({ min: 1, max: 12 }),
    });
    await fc.assert(fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 14 }), async ops => {
      const f = await createTenant("Prop");
      const batches = [await newBatch(f), await newBatch(f, days(90))];
      const stores = [f.storeId, await newStore(f, "p2")];
      let last: string | undefined;
      for (const o of ops) {
        const k = o.kind === "replay" && last ? last : key();
        last = k;
        const b = batches[o.batch], s = stores[o.store], other = stores[1 - o.store];
        try {
          if (o.kind === "receipt" || o.kind === "replay") await mv(f, { batchId: b, quantity: o.q, toStoreId: s, idempotencyKey: k });
          else if (o.kind === "issue" || o.kind === "dispense") await mv(f, { batchId: b, type: o.kind, quantity: o.q, fromStoreId: s, idempotencyKey: k });
          else if (o.kind === "damage") await mv(f, { batchId: b, type: "damage", quantity: o.q, fromStoreId: s, reason: "broken", idempotencyKey: k });
          else await withTenant(f.tenantId, c => transferStock(c, {
            tenantId: f.tenantId, itemId: f.itemId, batchId: b, quantity: o.q,
            fromStoreId: s, toStoreId: other, userId: f.userId, reference: "p", idempotencyKey: k,
          }), pool);
        } catch (e) { if (!(e instanceof StockError)) throw e; }
      }
      const diff = await withTenant(f.tenantId, c => reconcile(c, f.tenantId), pool);
      const neg = await admin.query("select count(*)::int n from stock_balances where tenant_id=$1 and quantity<0", [f.tenantId]);
      return diff.length === 0 && neg.rows[0].n === 0;
    }), { numRuns: 25 });
  });

  it("reconciliation reports a deliberately corrupted balance", async () => {
    const f = await createTenant("Corrupt");
    const b = await newBatch(f);
    await mv(f, { batchId: b, quantity: 5, toStoreId: f.storeId });
    await admin.query("update stock_balances set quantity=99 where batch_id=$1", [b]);
    const diff = await withTenant(f.tenantId, c => reconcile(c, f.tenantId), pool);
    expect(diff).toHaveLength(1);
    expect(Number(diff[0].stored)).toBe(99);
    expect(Number(diff[0].from_ledger)).toBe(5);
  });
});
