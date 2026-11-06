import express, { type Express } from "express";
import ExcelJS from "exceljs";
import type pg from "pg";
import { auditTx, ensureOwned, HttpError, route } from "../../http/route";

const HEADERS = [
  "Generic name", "Brand name", "Strength", "Unit", "Category", "Manufacturer", "Minimum quantity", "Reorder quantity",
  "Storage location", "Barcode", "Controlled (yes/no)", "Multi-dose (yes/no)", "Container volume ml",
  "Opening quantity", "Batch number", "Expiry date (YYYY-MM-DD)", "Unit cost (INR)",
] as const;

export async function templateXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Items");
  ws.columns = HEADERS.map(h => ({ header: h, key: h, width: Math.max(14, h.length + 2) }));
  ws.getRow(1).font = { bold: true };
  ws.addRow(["Meloxicam", "Metacam", "1.5 mg/ml", "ml", "Anti-inflammatory", "Example Pharma", 20, 100, "Shelf A2", "", "no", "no", "", 60, "MX-2041", "2027-08-31", 42.5]);
  const notes = wb.addWorksheet("Notes");
  notes.addRows([
    ["Delete the example row before you upload."],
    ["Generic name and Unit are required. Everything else is optional."],
    ["If you give an opening quantity, a batch number, expiry date and unit cost are also required."],
    ["Opening stock is saved as a draft receipt. Stock changes only when you confirm that receipt."],
  ]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

type RowResult = { row: number; errors: string[]; data?: ParsedRow };
type ParsedRow = {
  genericName: string; brandName: string | null; strength: string | null; unit: string; category: string | null; manufacturer: string | null;
  minQty: number; reorderQty: number; storageLocation: string | null; barcode: string | null; controlled: boolean; multiDose: boolean;
  doseVolumeMl: number | null; openingQty: number | null; batchNo: string | null; expiry: string | null; unitCostPaise: number | null;
};

const cellText = (v: ExcelJS.CellValue): string => {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v && v.result != null) return String(v.result).trim();
    if ("text" in v && v.text != null) return String(v.text).trim();
    if ("richText" in v) return v.richText.map(r => r.text).join("").trim();
    return "";
  }
  return String(v).trim();
};
const yes = (s: string) => /^(y|yes|true|1)$/i.test(s);
const num = (s: string) => (s === "" ? null : Number(s.replace(/,/g, "")));

export async function parseWorkbook(buf: Buffer): Promise<RowResult[]> {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf as unknown as ArrayBuffer); } catch { throw new HttpError(400, "invalid_file", "This file could not be read as an Excel workbook (.xlsx)."); }
  const ws = wb.getWorksheet("Items") ?? wb.worksheets[0];
  if (!ws) throw new HttpError(400, "invalid_file", "The workbook has no sheets.");
  const header = (ws.getRow(1).values as ExcelJS.CellValue[]).slice(1).map(cellText);
  const missing = HEADERS.filter(h => !header.includes(h));
  if (missing.length) throw new HttpError(400, "invalid_template", `Columns missing: ${missing.join(", ")}. Download the template and use it as is.`);
  const col = (name: string) => header.indexOf(name) + 1;
  const out: RowResult[] = [];
  const seenBarcodes = new Map<string, number>();
  const seenKeys = new Map<string, number>();
  ws.eachRow({ includeEmpty: false }, (row, i) => {
    if (i === 1) return;
    const g = (h: string) => cellText(row.getCell(col(h)).value);
    if (HEADERS.every(h => g(h) === "")) return;
    const errors: string[] = [];
    const genericName = g("Generic name"); const unit = g("Unit");
    if (!genericName) errors.push("Generic name is required.");
    if (genericName.length > 200) errors.push("Generic name is longer than 200 characters.");
    if (!unit) errors.push("Unit is required.");
    const minQty = num(g("Minimum quantity")) ?? 0; const reorderQty = num(g("Reorder quantity")) ?? 0;
    if (Number.isNaN(minQty) || minQty < 0) errors.push("Minimum quantity must be a number, 0 or more.");
    if (Number.isNaN(reorderQty) || reorderQty < 0) errors.push("Reorder quantity must be a number, 0 or more.");
    const multiDose = yes(g("Multi-dose (yes/no)"));
    const vol = num(g("Container volume ml"));
    if (multiDose && !(vol && vol > 0)) errors.push("A multi-dose item needs a container volume in ml.");
    const openingQty = num(g("Opening quantity"));
    const batchNo = g("Batch number") || null; const expiry = g("Expiry date (YYYY-MM-DD)") || null;
    const cost = num(g("Unit cost (INR)"));
    if (openingQty != null) {
      if (Number.isNaN(openingQty) || openingQty <= 0) errors.push("Opening quantity must be more than 0.");
      if (!batchNo) errors.push("Opening stock needs a batch number.");
      if (!expiry || !/^\d{4}-\d{2}-\d{2}$/.test(expiry) || Number.isNaN(Date.parse(expiry))) errors.push("Opening stock needs an expiry date as YYYY-MM-DD.");
      if (cost == null || Number.isNaN(cost) || cost < 0) errors.push("Opening stock needs a unit cost in rupees.");
    }
    const barcode = g("Barcode") || null;
    if (barcode) {
      if (seenBarcodes.has(barcode)) errors.push(`Barcode is repeated from row ${seenBarcodes.get(barcode)}.`); else seenBarcodes.set(barcode, i);
    }
    const key = `${genericName.toLowerCase()}|${g("Strength").toLowerCase()}|${unit.toLowerCase()}`;
    if (genericName && unit) {
      if (seenKeys.has(key)) errors.push(`Same name, strength and unit as row ${seenKeys.get(key)}.`); else seenKeys.set(key, i);
    }
    out.push({
      row: i, errors, data: {
        genericName, brandName: g("Brand name") || null, strength: g("Strength") || null, unit, category: g("Category") || null,
        manufacturer: g("Manufacturer") || null, minQty: minQty ?? 0, reorderQty: reorderQty ?? 0, storageLocation: g("Storage location") || null,
        barcode, controlled: yes(g("Controlled (yes/no)")), multiDose, doseVolumeMl: vol, openingQty, batchNo, expiry,
        unitCostPaise: cost == null || Number.isNaN(cost) ? null : Math.round(cost * 100),
      },
    });
  });
  return out;
}

export function registerImportRoutes(app: Express, pool: pg.Pool) {
  app.get("/api/import/template.xlsx", route(pool, "import.run", async ({ res }) => {
    res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .set("Content-Disposition", 'attachment; filename="vetflow-item-import-template.xlsx"').send(await templateXlsx());
  }));

  // Raw .xlsx bytes in the body. ?commit=true saves; without it the file is only checked.
  app.post("/api/import/items", express.raw({ type: () => true, limit: "5mb" }), route(pool, "import.run", async ({ c, user, req }) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, "invalid_file", "Choose an Excel file to upload.");
    const rows = await parseWorkbook(req.body);
    if (rows.length === 0) throw new HttpError(400, "empty", "The sheet has no item rows.");
    if (rows.length > 5000) throw new HttpError(400, "too_many", "Upload 5,000 rows or fewer at a time.");

    // Duplicates against the existing catalogue are errors, so nothing is silently merged.
    const existing = (await c.query("select lower(generic_name) g, lower(coalesce(strength,'')) s, lower(unit) u, barcode from items")).rows;
    const exKeys = new Set(existing.map(e => `${e.g}|${e.s}|${e.u}`));
    const exBarcodes = new Set(existing.map(e => e.barcode).filter(Boolean));
    for (const r of rows) {
      if (!r.data) continue;
      if (exKeys.has(`${r.data.genericName.toLowerCase()}|${(r.data.strength ?? "").toLowerCase()}|${r.data.unit.toLowerCase()}`)) r.errors.push("This item already exists in the catalogue.");
      if (r.data.barcode && exBarcodes.has(r.data.barcode)) r.errors.push("This barcode is already used by another item.");
    }
    const bad = rows.filter(r => r.errors.length);
    const summary = {
      rows: rows.length, valid: rows.length - bad.length, invalid: bad.length,
      errors: bad.map(r => ({ row: r.row, errors: r.errors })),
      opening: rows.filter(r => !r.errors.length && r.data?.openingQty).length,
    };
    if (req.query.commit !== "true") return { committed: false, ...summary };
    // All or nothing: one bad row stops the whole import so the file can be fixed and re-sent.
    if (bad.length) throw new HttpError(409, "validation_failed", `Fix ${bad.length} row(s) before importing. Nothing was saved.`, { errors: summary.errors });

    const storeId = String(req.query.storeId ?? "");
    const wantsStock = rows.some(r => r.data?.openingQty);
    if (wantsStock) { if (!storeId) throw new HttpError(400, "invalid", "storeId: choose the store that holds the opening stock"); await ensureOwned(c, "stores", [storeId]); }

    const cats = new Map<string, string>();
    const itemIds: Array<{ id: string; d: ParsedRow }> = [];
    for (const r of rows) {
      const d = r.data!;
      let categoryId: string | null = null;
      if (d.category) {
        if (!cats.has(d.category.toLowerCase())) {
          cats.set(d.category.toLowerCase(), (await c.query(
            "insert into categories (tenant_id, name) values ($1,$2) on conflict (tenant_id, name) do update set name = excluded.name returning id", [user.tenantId, d.category])).rows[0].id);
        }
        categoryId = cats.get(d.category.toLowerCase())!;
      }
      const it = await c.query(
        `insert into items (tenant_id, generic_name, brand_name, strength, unit, manufacturer, category_id, min_qty, reorder_qty, storage_location,
           barcode, controlled, multi_dose, dose_volume_ml) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
        [user.tenantId, d.genericName, d.brandName, d.strength, d.unit, d.manufacturer, categoryId, d.minQty, d.reorderQty, d.storageLocation,
          d.barcode, d.controlled, d.multiDose, d.doseVolumeMl]);
      itemIds.push({ id: it.rows[0].id, d });
    }
    let receiptId: string | null = null;
    const withStock = itemIds.filter(x => x.d.openingQty);
    if (withStock.length) {
      const sup = (await c.query(
        `insert into suppliers (tenant_id, name) values ($1,'Opening stock') on conflict (tenant_id, name) do update set name = excluded.name returning id`, [user.tenantId])).rows[0].id;
      receiptId = (await c.query(
        `insert into purchase_receipts (tenant_id, supplier_id, store_id, invoice_no, created_by) values ($1,$2,$3,'Opening stock import',$4) returning id`,
        [user.tenantId, sup, storeId, user.userId])).rows[0].id;
      for (const x of withStock) {
        await c.query(
          `insert into receipt_lines (tenant_id, receipt_id, item_id, batch_no, expiry_date, quantity, unit_cost_paise) values ($1,$2,$3,$4,$5,$6,$7)`,
          [user.tenantId, receiptId, x.id, x.d.batchNo, x.d.expiry, x.d.openingQty, x.d.unitCostPaise]);
      }
    }
    await auditTx(c, user, "import.items", "item", undefined, { items: itemIds.length, draftReceiptId: receiptId });
    return { committed: true, ...summary, itemsCreated: itemIds.length, draftReceiptId: receiptId };
  }, 200));
}
