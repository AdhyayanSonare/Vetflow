import type { Express } from "express";
import ExcelJS from "exceljs";
import type pg from "pg";
import { z } from "zod";
import type { SessionUser } from "../auth/service";
import { HttpError } from "../../http/route";

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/**
 * Stores this user may see. Admins and users with no branch assignment see everything (null).
 * Otherwise: stores of the assigned branches, plus the in-transit and central stores that have no branch.
 */
export async function allowedStores(c: pg.PoolClient, user: SessionUser): Promise<string[] | null> {
  if (user.role === "admin") return null;
  const a = await c.query("select count(*)::int n from user_branches where user_id = $1", [user.userId]);
  if (a.rows[0].n === 0) return null;
  const r = await c.query(
    `select s.id from stores s where s.branch_id is null or s.branch_id in (select branch_id from user_branches where user_id = $1)`, [user.userId]);
  return r.rows.map(x => x.id as string);
}

export const Filters = z.object({
  from: date.optional(), to: date.optional(), asOf: date.optional(), storeId: uuid.optional(), branchId: uuid.optional(),
  categoryId: uuid.optional(), departmentId: uuid.optional(), days: z.coerce.number().int().min(1).max(730).optional(),
  format: z.enum(["json", "csv", "xlsx"]).default("json"),
});
export type F = z.infer<typeof Filters>;

type Column = { key: string; label: string; type?: "money" | "qty" | "text" | "date" };
type Report = { title: string; columns: Column[]; rows: Record<string, unknown>[] };

/** Store filter shared by every query: explicit store, branch, and the user's allowed stores. */
export function storeClause(f: F, allowed: string[] | null, params: unknown[], col: string) {
  const parts: string[] = [];
  if (f.storeId) { params.push(f.storeId); parts.push(`${col} = $${params.length}`); }
  if (f.branchId) { params.push(f.branchId); parts.push(`${col} in (select id from stores where branch_id = $${params.length})`); }
  if (allowed) { params.push(allowed); parts.push(`${col} = any($${params.length}::uuid[])`); }
  return parts.length ? " and " + parts.join(" and ") : "";
}

/** Movements that touch an allowed store on either side (so receipts and transfers in are included). */
export function movementScope(f: F, allowed: string[] | null, p: unknown[]) {
  const from = storeClause(f, allowed, p, "l.from_store_id").replace(/^ and /, "");
  const to = storeClause(f, allowed, p, "l.to_store_id").replace(/^ and /, "");
  return from || to ? ` and ((${from || "false"}) or (${to || "false"}))` : "";
}

export async function buildReport(c: pg.PoolClient, name: string, f: F, allowed: string[] | null): Promise<Report> {
  const p: unknown[] = [];
  const cat = () => { if (!f.categoryId) return ""; p.push(f.categoryId); return ` and i.category_id = $${p.length}`; };
  const range = (col: string) => {
    let s = "";
    if (f.from) { p.push(f.from); s += ` and ${col} >= ist_day_start($${p.length}::date)`; }
    if (f.to) { p.push(f.to); s += ` and ${col} < ist_day_start($${p.length}::date + 1)`; }
    return s;
  };

  switch (name) {
    case "current-stock": {
      // With asOf the quantities are rebuilt from the ledger; without it they come from balances. Both must agree.
      if (f.asOf) {
        p.push(f.asOf);
        const sc1 = storeClause(f, allowed, p, "m.store_id");
        const rows = (await c.query(
          `select i.code, i.generic_name "item", i.unit, st.name "store", b.batch_no "batch", to_char(b.expiry_date,'YYYY-MM-DD') "expiry",
                  sum(m.delta)::float "quantity", b.unit_cost_paise::float "unitCostPaise", (sum(m.delta) * b.unit_cost_paise)::float "valuePaise"
             from (select item_id, batch_id, to_store_id store_id, quantity delta, at from stock_ledger where to_store_id is not null
                   union all select item_id, batch_id, from_store_id, -quantity, at from stock_ledger where from_store_id is not null) m
             join items i on i.id = m.item_id join batches b on b.id = m.batch_id join stores st on st.id = m.store_id
            where m.at < ist_day_start($1::date + 1) ${sc1} ${cat()}
            group by i.id, b.id, st.id having sum(m.delta) <> 0 order by i.generic_name, b.expiry_date`, p)).rows;
        return { title: `Current stock as of ${f.asOf}`, columns: stockCols(), rows };
      }
      const sc = storeClause(f, allowed, p, "sb.store_id");
      const rows = (await c.query(
        `select i.code, i.generic_name "item", i.unit, st.name "store", b.batch_no "batch", to_char(b.expiry_date,'YYYY-MM-DD') "expiry",
                sb.quantity::float "quantity", b.unit_cost_paise::float "unitCostPaise", (sb.quantity * b.unit_cost_paise)::float "valuePaise"
           from stock_balances sb join items i on i.id = sb.item_id join batches b on b.id = sb.batch_id join stores st on st.id = sb.store_id
          where sb.quantity <> 0 ${sc} ${cat()} order by i.generic_name, b.expiry_date`, p)).rows;
      return { title: "Current stock", columns: stockCols(), rows };
    }
    case "valuation": {
      const sc = storeClause(f, allowed, p, "sb.store_id");
      const rows = (await c.query(
        `select i.code, i.generic_name "item", coalesce(ct.name,'Uncategorised') "category", sum(sb.quantity)::float "quantity",
                sum(sb.quantity * b.unit_cost_paise)::float "valuePaise"
           from stock_balances sb join items i on i.id = sb.item_id join batches b on b.id = sb.batch_id left join categories ct on ct.id = i.category_id
          where sb.quantity > 0 ${sc} ${cat()} group by i.id, ct.name order by "valuePaise" desc`, p)).rows;
      return { title: "Stock valuation (actual batch cost)", columns: [
        { key: "code", label: "Code" }, { key: "item", label: "Item" }, { key: "category", label: "Category" },
        { key: "quantity", label: "Quantity", type: "qty" }, { key: "valuePaise", label: "Value", type: "money" }], rows };
    }
    case "movements": {
      const scope = movementScope(f, allowed, p);
      const rows = (await c.query(
        `select to_char(l.at at time zone 'Asia/Kolkata','YYYY-MM-DD HH24:MI') "when", l.type, i.generic_name "item", b.batch_no "batch",
                l.quantity::float "quantity", fs.name "from", ts.name "to", u.name "user", coalesce(l.reason,'') "reason", coalesce(l.reference,'') "reference"
           from stock_ledger l join items i on i.id = l.item_id join batches b on b.id = l.batch_id
           left join stores fs on fs.id = l.from_store_id left join stores ts on ts.id = l.to_store_id left join users u on u.id = l.user_id
          where true ${scope} ${cat()} ${range("l.at")} order by l.id desc limit 5000`, p)).rows;
      return { title: "Stock movements", columns: [
        { key: "when", label: "When (IST)" }, { key: "type", label: "Type" }, { key: "item", label: "Item" }, { key: "batch", label: "Batch" },
        { key: "quantity", label: "Quantity", type: "qty" }, { key: "from", label: "From" }, { key: "to", label: "To" },
        { key: "user", label: "User" }, { key: "reason", label: "Reason" }, { key: "reference", label: "Reference" }], rows };
    }
    case "expiry": {
      p.push(f.days ?? 90);
      const sc = storeClause(f, allowed, p, "sb.store_id");
      const rows = (await c.query(
        `select i.generic_name "item", b.batch_no "batch", to_char(b.expiry_date,'YYYY-MM-DD') "expiry", (b.expiry_date - today_ist()) "daysLeft",
                st.name "store", sb.quantity::float "quantity", (sb.quantity * b.unit_cost_paise)::float "valuePaise",
                case when b.expiry_date < today_ist() then 'Expired' else 'Expiring' end "status"
           from stock_balances sb join items i on i.id = sb.item_id join batches b on b.id = sb.batch_id join stores st on st.id = sb.store_id
          where sb.quantity > 0 and b.expiry_date <= today_ist() + $1::int ${sc} ${cat()} order by b.expiry_date`, p)).rows;
      return { title: `Batches expiring within ${f.days ?? 90} days`, columns: [
        { key: "item", label: "Item" }, { key: "batch", label: "Batch" }, { key: "expiry", label: "Expiry", type: "date" },
        { key: "daysLeft", label: "Days left", type: "qty" }, { key: "store", label: "Store" }, { key: "quantity", label: "Quantity", type: "qty" },
        { key: "valuePaise", label: "Value", type: "money" }, { key: "status", label: "Status" }], rows };
    }
    case "low-stock": {
      const sc = storeClause(f, allowed, p, "sb.store_id");
      const rows = (await c.query(
        `select * from (select i.code, i.generic_name "item", i.unit, coalesce(sum(sb.quantity),0)::float "onHand", i.min_qty::float "minQty",
                greatest(i.reorder_qty, i.min_qty * 2 - coalesce(sum(sb.quantity),0))::float "suggestedReorder"
           from items i left join stock_balances sb on sb.item_id = i.id ${sc.replace(" and ", " and ")} where i.active and i.min_qty > 0 ${cat()} group by i.id) t
          where "onHand" <= "minQty" order by "item"`, p)).rows;
      return { title: "Low stock", columns: [
        { key: "code", label: "Code" }, { key: "item", label: "Item" }, { key: "unit", label: "Unit" }, { key: "onHand", label: "On hand", type: "qty" },
        { key: "minQty", label: "Minimum", type: "qty" }, { key: "suggestedReorder", label: "Suggested reorder", type: "qty" }], rows };
    }
    case "purchases": {
      const rows = (await c.query(
        `select to_char(r.created_at at time zone 'Asia/Kolkata','YYYY-MM-DD') "date", s.name "supplier", coalesce(r.invoice_no,'') "invoice", r.status,
                i.generic_name "item", l.batch_no "batch", l.quantity::float "quantity", l.unit_cost_paise::float "unitCostPaise",
                (l.quantity * l.unit_cost_paise)::float "valuePaise"
           from purchase_receipts r join suppliers s on s.id = r.supplier_id join receipt_lines l on l.receipt_id = r.id join items i on i.id = l.item_id
          where r.status <> 'cancelled' ${cat()} ${range("r.created_at")} order by r.created_at desc limit 5000`, p)).rows;
      return { title: "Purchases", columns: [
        { key: "date", label: "Date" }, { key: "supplier", label: "Supplier" }, { key: "invoice", label: "Invoice" }, { key: "status", label: "Status" },
        { key: "item", label: "Item" }, { key: "batch", label: "Batch" }, { key: "quantity", label: "Quantity", type: "qty" },
        { key: "unitCostPaise", label: "Unit cost", type: "money" }, { key: "valuePaise", label: "Value", type: "money" }], rows };
    }
    case "consumption": {
      const fromS = storeClause(f, allowed, p, "l.from_store_id");
      let dep = "";
      if (f.departmentId) { p.push(`dept:${f.departmentId}`); dep = ` and l.reference = $${p.length}`; }
      const rows = (await c.query(
        `select i.generic_name "item", sum(l.quantity)::float "quantity", i.unit,
                sum(l.quantity * b.unit_cost_paise)::float "valuePaise",
                coalesce(max(d.name), 'Clinical and other') "department"
           from stock_ledger l join items i on i.id = l.item_id join batches b on b.id = l.batch_id
           left join departments d on l.reference = 'dept:' || d.id
          where l.type in ('dispense','issue') ${fromS} ${dep} ${cat()} ${range("l.at")}
          group by i.id, d.id order by "quantity" desc`, p)).rows;
      return { title: "Consumption (dispenses and issues)", columns: [
        { key: "item", label: "Item" }, { key: "department", label: "Department" }, { key: "quantity", label: "Quantity", type: "qty" },
        { key: "unit", label: "Unit" }, { key: "valuePaise", label: "Value", type: "money" }], rows };
    }
    case "wastage": {
      const fromS = storeClause(f, allowed, p, "l.from_store_id");
      const rows = (await c.query(
        `select to_char(l.at at time zone 'Asia/Kolkata','YYYY-MM-DD') "date", l.type, i.generic_name "item", b.batch_no "batch", l.quantity::float "quantity",
                (l.quantity * b.unit_cost_paise)::float "valuePaise", l.reason, u.name "user"
           from stock_ledger l join items i on i.id = l.item_id join batches b on b.id = l.batch_id left join users u on u.id = l.user_id
          where l.type in ('damage','expiry_writeoff') ${fromS} ${cat()} ${range("l.at")} order by l.at desc`, p)).rows;
      return { title: "Wastage and write-offs", columns: [
        { key: "date", label: "Date" }, { key: "type", label: "Type" }, { key: "item", label: "Item" }, { key: "batch", label: "Batch" },
        { key: "quantity", label: "Quantity", type: "qty" }, { key: "valuePaise", label: "Value", type: "money" },
        { key: "reason", label: "Reason" }, { key: "user", label: "User" }], rows };
    }
    case "audit": {
      const rows = (await c.query(
        `select to_char(a.at at time zone 'Asia/Kolkata','YYYY-MM-DD HH24:MI') "when", coalesce(u.name,'System') "user", a.action, a.entity,
                coalesce(a.entity_id,'') "entityId", coalesce(a.reason,'') "reason", coalesce(a.after::text,'') "details"
           from audit_log a left join users u on u.id = a.user_id where true ${range("a.at")} order by a.id desc limit 5000`, p)).rows;
      return { title: "Audit log", columns: [
        { key: "when", label: "When (IST)" }, { key: "user", label: "User" }, { key: "action", label: "Action" }, { key: "entity", label: "Entity" },
        { key: "entityId", label: "Entity id" }, { key: "reason", label: "Reason" }, { key: "details", label: "Details" }], rows };
    }
    default:
      throw new HttpError(404, "not_found", "Unknown report.");
  }
}
const stockCols = (): Column[] => [
  { key: "code", label: "Code" }, { key: "item", label: "Item" }, { key: "unit", label: "Unit" }, { key: "store", label: "Store" }, { key: "batch", label: "Batch" },
  { key: "expiry", label: "Expiry", type: "date" }, { key: "quantity", label: "Quantity", type: "qty" },
  { key: "unitCostPaise", label: "Unit cost", type: "money" }, { key: "valuePaise", label: "Value", type: "money" }];

/** Spreadsheet programs run text starting with = + - @ as formulas. Prefix such cells with an apostrophe. */
export const safeCell = (v: unknown) => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

const rupees = (paise: number) => paise / 100;
export function toCsv(r: Report): string {
  const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [r.columns.map(c => esc(c.label)).join(",")];
  for (const row of r.rows) lines.push(r.columns.map(c => esc(safeCell(c.type === "money" && typeof row[c.key] === "number" ? rupees(row[c.key] as number).toFixed(2) : row[c.key]))).join(","));
  return "﻿" + lines.join("\r\n");
}
export async function toXlsx(r: Report): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(r.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
  ws.columns = r.columns.map(c => ({ header: c.label, key: c.key, width: Math.max(12, c.label.length + 4) }));
  ws.getRow(1).font = { bold: true };
  for (const row of r.rows) {
    const o: Record<string, unknown> = {};
    for (const c of r.columns) o[c.key] = c.type === "money" && typeof row[c.key] === "number" ? rupees(row[c.key] as number) : safeCell(row[c.key]);
    ws.addRow(o);
  }
  r.columns.forEach((c, i) => { if (c.type === "money") ws.getColumn(i + 1).numFmt = '[$₹-4009] #,##,##0.00'; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

