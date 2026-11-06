import type { Express } from "express";
import type pg from "pg";
import { z } from "zod";
import { HttpError, route } from "../../http/route";
import { uuid } from "../../http/schemas";
import { allowedStores, buildReport, Filters, movementScope, storeClause, toCsv, toXlsx } from "./reports";

export function registerReportRoutes(app: Express, pool: pg.Pool) {
  app.get("/api/reports/:name", route(pool, "reports.read", async ({ c, user, req, res }) => {
    const f = Filters.parse(req.query);
    const rep = await buildReport(c, req.params.name, f, await allowedStores(c, user));
    if (req.params.name === "audit" && user.role !== "admin" && user.role !== "inventory_manager") throw new HttpError(403, "forbidden", "Your role cannot read the audit log.");
    const file = req.params.name.replace(/[^a-z-]/g, "");
    if (f.format === "csv") { res.type("text/csv").set("Content-Disposition", `attachment; filename="${file}.csv"`).send(toCsv(rep)); return; }
    if (f.format === "xlsx") {
      res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").set("Content-Disposition", `attachment; filename="${file}.xlsx"`).send(await toXlsx(rep));
      return;
    }
    return rep;
  }));

  app.get("/api/dashboard", route(pool, "reports.read", async ({ c, user, req }) => {
    const f = Filters.omit({ format: true }).parse(req.query);
    const allowed = await allowedStores(c, user);
    const p: unknown[] = [];
    const sc = storeClause({ ...f, format: "json" }, allowed, p, "sb.store_id");
    const catJoin = f.categoryId ? (p.push(f.categoryId), ` and i.category_id = $${p.length}`) : "";
    const stock = (await c.query(
      `select coalesce(sum(sb.quantity * b.unit_cost_paise),0)::float "stockValuePaise",
              count(distinct sb.item_id) filter (where sb.quantity > 0)::int "itemsInStock",
              coalesce(sum(sb.quantity * b.unit_cost_paise) filter (where b.expiry_date <= today_ist() + 30 and sb.quantity > 0),0)::float "valueExpiring30Paise",
              count(distinct sb.batch_id) filter (where sb.quantity > 0 and b.expiry_date < today_ist())::int "expiredBatches",
              count(distinct sb.batch_id) filter (where sb.quantity > 0 and b.expiry_date >= today_ist() and b.expiry_date <= today_ist() + 30)::int "expiring30",
              count(distinct sb.batch_id) filter (where sb.quantity > 0 and b.expiry_date > today_ist() + 30 and b.expiry_date <= today_ist() + 60)::int "expiring60",
              count(distinct sb.batch_id) filter (where sb.quantity > 0 and b.expiry_date > today_ist() + 60 and b.expiry_date <= today_ist() + 90)::int "expiring90"
         from stock_balances sb join batches b on b.id = sb.batch_id join items i on i.id = sb.item_id where true ${sc} ${catJoin}`, p)).rows[0];

    const cat2: unknown[] = []; const catSql = f.categoryId ? (cat2.push(f.categoryId), " and category_id = $1") : "";
    const activeItems = (await c.query(`select count(*)::int n from items where active ${catSql}`, cat2)).rows[0].n;
    const lowStock = (await buildReport(c, "low-stock", { ...f, format: "json" }, allowed)).rows.length;
    const pendingPurchases = (await c.query("select count(*)::int n from purchase_receipts where status = 'draft'")).rows[0].n;

    const q: unknown[] = [];
    const fromS = storeClause({ ...f, format: "json" }, allowed, q, "l.from_store_id");
    let rangeSql = "";
    if (f.from) { q.push(f.from); rangeSql += ` and l.at >= ist_day_start($${q.length}::date)`; }
    if (f.to) { q.push(f.to); rangeSql += ` and l.at < ist_day_start($${q.length}::date + 1)`; }
    const topConsumed = (await c.query(
      `select i.generic_name "item", sum(l.quantity)::float quantity, i.unit from stock_ledger l join items i on i.id = l.item_id
        where l.type in ('dispense','issue') ${fromS} ${rangeSql} group by i.id order by quantity desc limit 5`, q)).rows;
    const byDepartment = (await c.query(
      `select coalesce(d.name,'Clinical and other') department, sum(l.quantity)::float quantity
         from stock_ledger l left join departments d on l.reference = 'dept:' || d.id
        where l.type in ('dispense','issue') ${fromS} ${rangeSql} group by d.id order by quantity desc`, q)).rows;
    const r2: unknown[] = [];
    const scope = movementScope({ ...f, format: "json" }, allowed, r2);
    const recent = (await c.query(
      `select l.id, l.at, l.type, l.quantity::float quantity, i.generic_name "item", u.name "user", l.reason
         from stock_ledger l join items i on i.id = l.item_id left join users u on u.id = l.user_id
        where true ${scope} order by l.id desc limit 8`, r2)).rows;
    const alerts = (await c.query("select count(*)::int n from alerts where resolved_at is null")).rows[0].n;
    return { ...stock, activeItems, lowStock, pendingPurchases, openAlerts: alerts, topConsumed, consumptionByDepartment: byDepartment, recentMovements: recent };
  }));

  app.get("/api/alerts", route(pool, "catalogue.read", async ({ c, req }) =>
    (await c.query(
      `select id, kind, severity, message, created_at "createdAt", resolved_at "resolvedAt" from alerts
        where ($1::boolean or resolved_at is null) order by (severity = 'critical') desc, created_at desc limit 200`, [req.query.all === "true"])).rows));
  app.post("/api/alerts/:id/resolve", route(pool, "stock.adjust", async ({ c, req }) => {
    const r = await c.query("update alerts set resolved_at = now() where id = $1 and resolved_at is null returning id", [uuid.parse(req.params.id)]);
    if (!r.rowCount) throw new HttpError(404, "not_found", "Alert not found.");
    return { ok: true };
  }));
}
