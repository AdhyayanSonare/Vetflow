import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runNightly, runTenantChecks } from "../../server/jobs/nightly";
import { createTenant } from "../helpers";
import { days, harness } from "../harness";

const h = harness();
beforeAll(async () => { await h.init(); });
afterAll(async () => { await h.done(); });

async function sheet(buf: Buffer, name?: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return name ? wb.getWorksheet(name)! : wb.worksheets[0];
}

describe("reports reconcile with the ledger", () => {
  it("current stock equals the ledger, as stored and as of today, and valuation uses batch cost", async () => {
    const w = await h.stocked({ qty: 40 });
    await w.pharm.call("POST", "/api/stock/issue", { itemId: w.item.id, storeId: w.f.storeId, quantity: 6, reason: "Ward use" });
    const t = (await w.mgr.call("POST", "/api/transfers", { fromStoreId: w.f.storeId, toStoreId: w.store2, lines: [{ itemId: w.item.id, quantity: 10 }] })).json;
    const sent = (await w.mgr.call("POST", `/api/transfers/${t.id}/dispatch`)).json;
    await w.mgr.call("POST", `/api/transfers/${t.id}/receive`, { lines: [{ lineId: sent.lines[0].id, receivedQty: 10 }] });

    const stored = (await w.mgr.call("GET", "/api/reports/current-stock")).json.rows;
    const asOf = (await w.mgr.call("GET", `/api/reports/current-stock?asOf=${days(0)}`)).json.rows;
    const key = (r: { store: string; batch: string; quantity: number }) => `${r.store}|${r.batch}|${r.quantity}`;
    expect(stored.map(key).sort()).toEqual(asOf.map(key).sort());
    expect(stored.reduce((a: number, r: { quantity: number }) => a + r.quantity, 0)).toBe(34);
    const fromLedger = Number((await h.admin.query("select sum(quantity) q from ledger_balances where tenant_id=$1 and item_id=$2", [w.f.tenantId, w.item.id])).rows[0].q);
    expect(fromLedger).toBe(34);

    const val = (await w.mgr.call("GET", "/api/reports/valuation")).json.rows[0];
    expect(val.valuePaise).toBe(34 * 100);                    // 34 units at 100 paise
    const storeOnly = (await w.mgr.call("GET", `/api/reports/current-stock?storeId=${w.store2}`)).json.rows;
    expect(storeOnly.map((r: { quantity: number }) => r.quantity)).toEqual([10]);
  });

  it("as-of a past date shows the stock before later movements", async () => {
    const w = await h.stocked({ qty: 10 });
    const yesterday = days(-1);
    expect((await w.mgr.call("GET", `/api/reports/current-stock?asOf=${yesterday}`)).json.rows).toEqual([]);
    expect((await w.mgr.call("GET", `/api/reports/current-stock?asOf=${days(1)}`)).json.rows).toHaveLength(1);
  });

  it("movement, expiry, low-stock, purchase, consumption, wastage and audit reports return rows", async () => {
    const w = await h.stocked({ qty: 5, expiry: 20 });
    await w.mgr.call("PATCH", `/api/items/${w.item.id}`, { minQty: 10 });
    await w.pharm.call("POST", "/api/stock/issue", { itemId: w.item.id, storeId: w.f.storeId, quantity: 1, reason: "Ward use" });
    const st = (await w.mgr.call("GET", "/api/stock")).json[0];
    await w.mgr.call("POST", "/api/stock/adjust", { type: "damage", itemId: w.item.id, batchId: st.batchId, storeId: w.f.storeId, quantity: 1, reason: "Dropped" });
    for (const name of ["movements", "expiry", "low-stock", "purchases", "consumption", "wastage", "audit"]) {
      const r = await w.mgr.call("GET", `/api/reports/${name}`);
      expect(r.status, name).toBe(200);
      expect(r.json.rows.length, name).toBeGreaterThan(0);
      expect(r.json.columns.length, name).toBeGreaterThan(2);
    }
    expect((await w.mgr.call("GET", "/api/reports/expiry?days=10")).json.rows).toEqual([]);
    expect((await w.mgr.call("GET", "/api/reports/nope")).status).toBe(404);
    expect((await w.mgr.call("GET", `/api/reports/movements?from=${days(0)}&to=${days(0)}`)).json.rows.length).toBeGreaterThan(0);
    expect((await w.mgr.call("GET", `/api/reports/movements?from=${days(5)}`)).json.rows).toEqual([]);
  });

  it("the audit report is limited to admins and inventory managers", async () => {
    const w = await h.stocked();
    expect((await w.pharm.call("GET", "/api/reports/audit")).status).toBe(403);
    expect((await w.vet.call("GET", "/api/reports/audit")).status).toBe(403);
    expect((await w.mgr.call("GET", "/api/reports/audit")).status).toBe(200);
  });
});

describe("exports", () => {
  it("CSV and Excel exports hold the same rows, in rupees, and neutralise spreadsheet formulas", async () => {
    const w = await h.stocked({ qty: 3 });
    await w.mgr.call("POST", "/api/items", { genericName: "=HYPERLINK(\"http://evil\")", unit: "box", confirmSimilar: true });
    const csv = await w.mgr.call("GET", "/api/reports/current-stock?format=csv");
    expect(csv.headers.get("content-type")).toMatch(/text\/csv/);
    expect(csv.text).toContain("Value");
    expect(csv.text).toContain("3.00");                         // 3 units at Rs 1.00 each, shown as rupees
    const xl = await w.mgr.call("GET", "/api/reports/current-stock?format=xlsx");
    expect(xl.buf.subarray(0, 2).toString()).toBe("PK");
    const ws = await sheet(xl.buf);
    expect(ws.getRow(1).getCell(1).value).toBe("Code");
    expect(ws.rowCount).toBe(2);
    expect(ws.getRow(2).getCell(9).value).toBe(3);               // value in rupees
    // The dangerous name never appears as a bare formula in any export.
    const { safeCell } = await import("../../server/modules/reports/reports");
    expect(safeCell("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
    expect(safeCell("+1+1")).toBe("'+1+1");
    expect(safeCell("normal")).toBe("normal");
  });
});

describe("dashboard", () => {
  it("shows stock value, expiry bands, low stock, pending purchases, top consumed and recent movements", async () => {
    const w = await h.stocked({ qty: 20, expiry: 25 });
    await w.mgr.call("PATCH", `/api/items/${w.item.id}`, { minQty: 30 });
    await w.pharm.call("POST", "/api/stock/issue", { itemId: w.item.id, storeId: w.f.storeId, quantity: 5, reason: "Ward use" });
    await w.mgr.call("POST", "/api/receipts", { supplierId: w.sup.id, storeId: w.f.storeId, lines: [{ itemId: w.item.id, batchNo: "D2", expiryDate: days(200), quantity: 1, unitCostPaise: 1 }] });
    const d = (await w.mgr.call("GET", "/api/dashboard")).json;
    expect(d.stockValuePaise).toBe(15 * 100);
    expect(d.expiring30).toBe(1);
    expect(d.lowStock).toBe(1);
    expect(d.pendingPurchases).toBe(1);
    expect(d.activeItems).toBeGreaterThanOrEqual(2);
    expect(d.topConsumed[0]).toMatchObject({ quantity: 5 });
    expect(d.recentMovements.length).toBeGreaterThan(0);
    expect(d.recentMovements.map((m: { type: string }) => m.type)).toContain("receipt");
    const filtered = (await w.mgr.call("GET", `/api/dashboard?storeId=${w.store2}`)).json;
    expect(filtered.stockValuePaise).toBe(0);
    expect((await w.vet.call("GET", "/api/dashboard")).status).toBe(200);
  });
});

describe("branch scoping", () => {
  it("a user assigned to one branch sees only that branch's stock and movements", async () => {
    const w = await h.stocked({ qty: 10 });
    const branch2 = (await h.admin.query("insert into branches (tenant_id, name) values ($1,'Second branch') returning id", [w.f.tenantId])).rows[0].id;
    const s2 = (await h.admin.query("insert into stores (tenant_id, branch_id, kind, name) values ($1,$2,'branch','Second branch store') returning id", [w.f.tenantId, branch2])).rows[0].id;
    const t = (await w.mgr.call("POST", "/api/transfers", { fromStoreId: w.f.storeId, toStoreId: s2, lines: [{ itemId: w.item.id, quantity: 4 }] })).json;
    const sent = (await w.mgr.call("POST", `/api/transfers/${t.id}/dispatch`)).json;
    await w.mgr.call("POST", `/api/transfers/${t.id}/receive`, { lines: [{ lineId: sent.lines[0].id, receivedQty: 4 }] });
    const local = await h.mkUser(w.f, "inventory_manager");
    await h.admin.query("insert into user_branches (tenant_id,user_id,branch_id) values ($1,$2,$3)", [w.f.tenantId, local.id, branch2]);
    const { PW } = await import("../harness");
    const scoped = await (async () => {
      const { createApp } = await import("../../server/app");
      const { serve } = await import("../helpers");
      const sv = await serve(createApp(h.pool));
      await sv.call("POST", "/api/auth/login", { email: local.email, password: PW });
      return sv;
    })();
    const rows = (await scoped.call("GET", "/api/reports/current-stock")).json.rows;
    expect(rows.map((r: { store: string }) => r.store)).toEqual(["Second branch store"]);
    expect((await scoped.call("GET", "/api/dashboard")).json.stockValuePaise).toBe(4 * 100);
    expect((await w.mgr.call("GET", "/api/dashboard")).json.stockValuePaise).toBe(10 * 100);
    await scoped.close();
  });
});

describe("nightly checks and alerts", () => {
  it("a corrupted balance raises one critical alert, is not duplicated, and clears when fixed", async () => {
    const w = await h.stocked({ qty: 10 });
    const first = await runTenantChecks(h.pool, w.f.tenantId);
    expect(first.reconciliationProblems).toBe(0);
    await h.admin.query("update stock_balances set quantity = 99 where item_id = $1", [w.item.id]);
    const a = await runTenantChecks(h.pool, w.f.tenantId);
    expect(a.reconciliationProblems).toBe(1);
    await runTenantChecks(h.pool, w.f.tenantId);
    const alerts = (await w.mgr.call("GET", "/api/alerts")).json.filter((x: { kind: string }) => x.kind === "reconciliation");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("critical");
    await h.admin.query("update stock_balances set quantity = 10 where item_id = $1", [w.item.id]);
    await runTenantChecks(h.pool, w.f.tenantId);
    expect((await w.mgr.call("GET", "/api/alerts")).json.filter((x: { kind: string }) => x.kind === "reconciliation")).toHaveLength(0);
  });

  it("raises expiry, expired and low-stock alerts once, and low-stock clears after a restock", async () => {
    const w = await h.stocked({ qty: 3, expiry: 25 });
    await w.mgr.call("PATCH", `/api/items/${w.item.id}`, { minQty: 5 });
    const exp = (await w.mgr.call("POST", "/api/receipts", { supplierId: w.sup.id, storeId: w.f.storeId, lines: [{ itemId: w.item.id, batchNo: "OLD", expiryDate: days(-2), quantity: 2, unitCostPaise: 1 }] })).json;
    await w.mgr.call("POST", `/api/receipts/${exp.id}/confirm`);
    const r1 = await runTenantChecks(h.pool, w.f.tenantId);
    expect(r1.expiryAlerts).toBe(2);
    expect(r1.lowStockAlerts).toBe(1);
    const r2 = await runTenantChecks(h.pool, w.f.tenantId);
    expect(r2.expiryAlerts + r2.lowStockAlerts).toBe(0);
    const kinds = (await w.mgr.call("GET", "/api/alerts")).json.map((a: { kind: string }) => a.kind).sort();
    expect(kinds).toEqual(["expired", "expiring_30", "low_stock"]);
    const more = (await w.mgr.call("POST", "/api/receipts", { supplierId: w.sup.id, storeId: w.f.storeId, lines: [{ itemId: w.item.id, batchNo: "NEW", expiryDate: days(400), quantity: 50, unitCostPaise: 1 }] })).json;
    await w.mgr.call("POST", `/api/receipts/${more.id}/confirm`);
    await runTenantChecks(h.pool, w.f.tenantId);
    expect((await w.mgr.call("GET", "/api/alerts")).json.map((a: { kind: string }) => a.kind)).not.toContain("low_stock");
    const al = (await w.mgr.call("GET", "/api/alerts")).json[0];
    expect((await w.pharm.call("POST", `/api/alerts/${al.id}/resolve`)).status).toBe(403);
    expect((await w.mgr.call("POST", `/api/alerts/${al.id}/resolve`)).status).toBe(200);
  });

  it("the nightly run covers every tenant, and alerts stay inside their tenant", async () => {
    const a = await h.stocked({ qty: 4 });
    const b = await h.stocked({ qty: 4 });
    await h.admin.query("update stock_balances set quantity = 50 where item_id = $1", [a.item.id]);
    const res = await runNightly(h.pool);
    expect(res.tenants).toBeGreaterThanOrEqual(2);
    expect(res.reconciliationProblems).toBeGreaterThanOrEqual(1);
    expect((await a.mgr.call("GET", "/api/alerts")).json.some((x: { kind: string }) => x.kind === "reconciliation")).toBe(true);
    expect((await b.mgr.call("GET", "/api/alerts")).json.some((x: { kind: string }) => x.kind === "reconciliation")).toBe(false);
    await h.admin.query("update stock_balances set quantity = 4 where item_id = $1", [a.item.id]);
    expect((await createTenant("JobsUnused")).tenantId).toBeTruthy();
  });
});

describe("tenant isolation in reports", () => {
  it("no report, export or dashboard shows another tenant's data", async () => {
    const a = await h.stocked({ qty: 7 });
    await a.mgr.call("POST", "/api/items", { genericName: "Zzsecretitem", unit: "ml" });
    const b = await h.stocked({ qty: 3 });
    for (const name of ["current-stock", "valuation", "movements", "expiry", "low-stock", "purchases", "consumption", "wastage", "audit"]) {
      for (const fmt of ["json", "csv"]) {
        const r = await b.mgr.call("GET", `/api/reports/${name}?format=${fmt}&days=730`);
        expect(r.status, name).toBe(200);
        expect(r.text, `${name} ${fmt}`).not.toMatch(/Zzsecretitem/);
        expect(r.text, `${name} ${fmt}`).not.toContain(a.item.id);
      }
    }
    expect((await b.mgr.call("GET", "/api/dashboard")).json.stockValuePaise).toBe(3 * 100);
    expect((await b.mgr.call("GET", `/api/reports/current-stock?storeId=${a.f.storeId}`)).json.rows).toEqual([]);
  });
});
