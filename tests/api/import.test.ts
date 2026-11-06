import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { harness } from "../harness";

const h = harness();
beforeAll(async () => { await h.init(); });
afterAll(async () => { await h.done(); });

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Takes the downloaded template, replaces the example row with the given rows, and returns the file bytes. */
async function workbook(template: Buffer, rows: Array<Array<string | number>>) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(template as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("Items")!;
  ws.spliceRows(2, ws.rowCount);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const row = (o: Partial<Record<string, string | number>> = {}) => [
  o.generic ?? "Prednisolone", o.brand ?? "", o.strength ?? "10 mg", o.unit ?? "tablet", o.category ?? "Steroids", "", o.min ?? 10, o.reorder ?? 50,
  "", o.barcode ?? "", o.controlled ?? "no", o.multi ?? "no", o.vol ?? "", o.open ?? "", o.batch ?? "", o.expiry ?? "", o.cost ?? "",
];

describe("item import", () => {
  it("serves a template with the expected columns and a notes sheet", async () => {
    const w = await h.stocked();
    const r = await w.mgr.call("GET", "/api/import/template.xlsx");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("spreadsheetml");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.buf as unknown as ArrayBuffer);
    expect(wb.getWorksheet("Items")!.getRow(1).getCell(1).value).toBe("Generic name");
    expect(wb.getWorksheet("Notes")).toBeTruthy();
    expect((await w.pharm.call("GET", "/api/import/template.xlsx")).status).toBe(403);
  });

  it("a check-only run lists row errors and saves nothing", async () => {
    const w = await h.stocked();
    const tpl = (await w.mgr.call("GET", "/api/import/template.xlsx")).buf;
    const file = await workbook(tpl, [
      row({ generic: "Good item one", unit: "tablet" }),
      row({ generic: "", unit: "ml" }),
      row({ generic: "Opening no batch", open: 10 }),
      row({ generic: "Vial no volume", multi: "yes", unit: "vial" }),
      row({ generic: "Negative min", min: -2 }),
    ]);
    const before = (await w.mgr.call("GET", "/api/items")).json.length;
    const r = await w.mgr.call("POST", "/api/import/items", undefined, { raw: file, contentType: XLSX });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ committed: false, rows: 5, valid: 1, invalid: 4 });
    const byRow = Object.fromEntries(r.json.errors.map((e: { row: number; errors: string[] }) => [e.row, e.errors.join(" ")]));
    expect(byRow[3]).toMatch(/Generic name is required/);
    expect(byRow[4]).toMatch(/batch number/);
    expect(byRow[5]).toMatch(/container volume/);
    expect(byRow[6]).toMatch(/Minimum quantity/);
    expect((await w.mgr.call("GET", "/api/items")).json.length).toBe(before);
  });

  it("one bad row stops a commit and nothing is saved", async () => {
    const w = await h.stocked();
    const tpl = (await w.mgr.call("GET", "/api/import/template.xlsx")).buf;
    const file = await workbook(tpl, [row({ generic: "Fine item" }), row({ generic: "", unit: "ml" })]);
    const before = (await w.mgr.call("GET", "/api/items")).json.length;
    const r = await w.mgr.call("POST", "/api/import/items?commit=true", undefined, { raw: file, contentType: XLSX });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("validation_failed");
    expect(r.json.error.errors).toHaveLength(1);
    expect((await w.mgr.call("GET", "/api/items")).json.length).toBe(before);
  });

  it("commits items and opening stock as a draft receipt; stock changes only when the receipt is confirmed", async () => {
    const w = await h.stocked();
    const tpl = (await w.mgr.call("GET", "/api/import/template.xlsx")).buf;
    const file = await workbook(tpl, [
      row({ generic: "Dexamethasone", strength: "4 mg/ml", unit: "ml", open: 40, batch: "DX-1", expiry: "2028-01-31", cost: 12.5, category: "Steroids" }),
      row({ generic: "Gauze swabs", strength: "", unit: "pack", category: "Consumables", barcode: "8901111111111" }),
      row({ generic: "Ketamine", strength: "50 mg/ml", unit: "vial", controlled: "yes", multi: "yes", vol: 10 }),
    ]);
    const r = await w.mgr.call("POST", `/api/import/items?commit=true&storeId=${w.f.storeId}`, undefined, { raw: file, contentType: XLSX });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ committed: true, itemsCreated: 3 });
    expect(r.json.draftReceiptId).toBeTruthy();

    const items = (await w.mgr.call("GET", "/api/items?q=Ketamine")).json;
    expect(items[0]).toMatchObject({ controlled: true, multiDose: true, doseVolumeMl: 10 });
    const dex = (await w.mgr.call("GET", "/api/items?q=Dexamethasone")).json[0];
    expect(dex.onHand).toBe(0);                                           // import alone puts nothing on the shelf
    const rc = (await w.mgr.call("GET", `/api/receipts/${r.json.draftReceiptId}`)).json;
    expect(rc).toMatchObject({ status: "draft", supplierName: "Opening stock" });
    expect(rc.lines[0]).toMatchObject({ quantity: 40, unitCostPaise: 1250, batchNo: "DX-1" });

    await w.mgr.call("POST", `/api/receipts/${rc.id}/confirm`);
    expect((await w.mgr.call("GET", "/api/items?q=Dexamethasone")).json[0].onHand).toBe(40);
    expect((await w.mgr.call("GET", "/api/reports/audit")).json.rows.map((x: { action: string }) => x.action)).toContain("import.items");
  });

  it("refuses duplicates of existing items and barcodes, and repeated rows in the file", async () => {
    const w = await h.stocked();
    const tpl = (await w.mgr.call("GET", "/api/import/template.xlsx")).buf;
    await w.mgr.call("POST", "/api/items", { genericName: "Existing drug", strength: "5 mg", unit: "tablet", barcode: "8902222222222" });
    const file = await workbook(tpl, [
      row({ generic: "Existing drug", strength: "5 mg", unit: "tablet" }),
      row({ generic: "Brand new one", barcode: "8902222222222" }),
      row({ generic: "Twice", strength: "1 mg" }),
      row({ generic: "Twice", strength: "1 mg" }),
    ]);
    const r = await w.mgr.call("POST", "/api/import/items", undefined, { raw: file, contentType: XLSX });
    const msgs = r.json.errors.map((e: { errors: string[] }) => e.errors.join(" ")).join("|");
    expect(msgs).toMatch(/already exists/);
    expect(msgs).toMatch(/barcode is already used/i);
    expect(msgs).toMatch(/Same name, strength and unit as row/);
    expect(r.json.invalid).toBe(3);
  });

  it("rejects a file that is not a workbook, a workbook without the template columns, and an empty upload", async () => {
    const w = await h.stocked();
    const bad = await w.mgr.call("POST", "/api/import/items", undefined, { raw: Buffer.from("not a spreadsheet"), contentType: XLSX });
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe("invalid_file");
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Sheet1").addRow(["Name", "Qty"]);
    const wrong = await w.mgr.call("POST", "/api/import/items", undefined, { raw: Buffer.from(await wb.xlsx.writeBuffer()), contentType: XLSX });
    expect(wrong.json.error.code).toBe("invalid_template");
    expect((await w.mgr.call("POST", "/api/import/items", undefined, { raw: Buffer.alloc(0), contentType: XLSX })).status).toBe(400);
    expect((await w.pharm.call("POST", "/api/import/items", undefined, { raw: Buffer.from("x"), contentType: XLSX })).status).toBe(403);
  });

  it("opening stock needs a store from this tenant", async () => {
    const a = await h.stocked();
    const b = await h.stocked();
    const tpl = (await a.mgr.call("GET", "/api/import/template.xlsx")).buf;
    const file = await workbook(tpl, [row({ generic: "Stocked import", open: 5, batch: "Z1", expiry: "2028-05-31", cost: 3 })]);
    expect((await a.mgr.call("POST", "/api/import/items?commit=true", undefined, { raw: file, contentType: XLSX })).status).toBe(400);
    const cross = await a.mgr.call("POST", `/api/import/items?commit=true&storeId=${b.f.storeId}`, undefined, { raw: file, contentType: XLSX });
    expect(cross.status).toBe(404);
    expect((await a.mgr.call("GET", "/api/items?q=Stocked import")).json).toEqual([]);
    expect((await b.mgr.call("GET", "/api/items?q=Stocked import")).json).toEqual([]);
  });
});
