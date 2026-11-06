import type pg from "pg";
import { withTenant } from "../db/pool";
import { reconcile } from "../modules/stock/ledger";

export type JobResult = { tenants: number; reconciliationProblems: number; expiryAlerts: number; lowStockAlerts: number; transcriptsPurged: number };

async function addAlert(c: pg.PoolClient, tenantId: string, kind: string, severity: string, message: string, ref: string) {
  const r = await c.query(
    `insert into alerts (tenant_id, kind, severity, message, ref) values ($1,$2,$3,$4,$5)
     on conflict (tenant_id, kind, ref) where resolved_at is null and ref is not null do nothing returning id`,
    [tenantId, kind, severity, message, ref]);
  return r.rowCount ?? 0;
}

/**
 * Nightly check for one tenant: recompute balances from the ledger and alert on any difference,
 * then raise expiry and low-stock alerts. Safe to run again: open alerts are not duplicated.
 */
export async function runTenantChecks(pool: pg.Pool, tenantId: string): Promise<Omit<JobResult, "tenants">> {
  return withTenant(tenantId, async c => {
    const out = { reconciliationProblems: 0, expiryAlerts: 0, lowStockAlerts: 0, transcriptsPurged: 0 };

    const diff = await reconcile(c, tenantId);
    for (const d of diff) {
      out.reconciliationProblems += 1;
      await addAlert(c, tenantId, "reconciliation", "critical",
        `Balance differs from the ledger: stored ${Number(d.stored)}, ledger ${Number(d.from_ledger)}.`, `recon:${d.batch_id}:${d.store_id}`);
    }
    // A fixed balance should clear its old alert.
    await c.query(
      `update alerts set resolved_at = now() where tenant_id = $1 and kind = 'reconciliation' and resolved_at is null
         and ref not in (select 'recon:' || batch_id || ':' || store_id from reconcile_balances($1))`, [tenantId]);

    const days = (await c.query("select expiry_alert_days from tenant_settings where tenant_id = $1", [tenantId])).rows[0]?.expiry_alert_days ?? [90, 60, 30];
    const batches = (await c.query(
      `select b.id, i.generic_name, b.batch_no, (b.expiry_date - today_ist()) left_days, sum(sb.quantity)::float qty
         from stock_balances sb join batches b on b.id = sb.batch_id join items i on i.id = sb.item_id
        where sb.quantity > 0 group by b.id, i.generic_name`)).rows;
    const thresholds = [...days].sort((a: number, b: number) => a - b);
    for (const b of batches) {
      if (b.left_days < 0) {
        out.expiryAlerts += await addAlert(c, tenantId, "expired", "critical",
          `${b.generic_name} batch ${b.batch_no} has expired with ${b.qty} in stock.`, `expired:${b.id}`);
        continue;
      }
      const band = thresholds.find((d: number) => b.left_days <= d);
      if (band !== undefined) {
        out.expiryAlerts += await addAlert(c, tenantId, `expiring_${band}`, band <= 30 ? "warning" : "info",
          `${b.generic_name} batch ${b.batch_no} expires in ${b.left_days} days (${b.qty} in stock).`, `expiring:${b.id}`);
      }
    }

    const low = (await c.query(
      `select i.id, i.generic_name, i.min_qty::float min_qty, coalesce(sum(sb.quantity),0)::float on_hand
         from items i left join stock_balances sb on sb.item_id = i.id where i.active and i.min_qty > 0
        group by i.id having coalesce(sum(sb.quantity),0) <= i.min_qty`)).rows;
    for (const i of low) {
      out.lowStockAlerts += await addAlert(c, tenantId, "low_stock", "warning",
        `${i.generic_name} is at ${i.on_hand}, at or below the minimum of ${i.min_qty}.`, `low:${i.id}`);
    }
    // Items back above minimum clear their alert.
    await c.query(
      `update alerts set resolved_at = now() where tenant_id = $1 and kind = 'low_stock' and resolved_at is null
         and ref not in (select 'low:' || i.id from items i left join stock_balances sb on sb.item_id = i.id
                          where i.active and i.min_qty > 0 group by i.id having coalesce(sum(sb.quantity),0) <= i.min_qty)`, [tenantId]);

    // Transcript retention is a tenant setting. 0 keeps transcripts until the consultation is removed.
    const retentionDays = Number((await c.query("select transcript_retention_days d from tenant_settings where tenant_id = $1", [tenantId])).rows[0]?.d ?? 0);
    if (retentionDays > 0) {
      const purged = await c.query("delete from transcripts where created_at < now() - make_interval(days => $1)", [retentionDays]);
      out.transcriptsPurged = purged.rowCount ?? 0;
      if (out.transcriptsPurged) {
        await c.query("insert into audit_log (tenant_id, action, entity, after, reason) values ($1,'transcripts.purge','transcript',$2,$3)",
          [tenantId, JSON.stringify({ count: out.transcriptsPurged, retentionDays }), "Tenant retention setting"]);
      }
    }
    return out;
  }, pool);
}

export async function runNightly(pool: pg.Pool): Promise<JobResult> {
  const tenants = (await pool.query("select id from list_tenants()")).rows.map(r => r.id as string);
  const total: JobResult = { tenants: tenants.length, reconciliationProblems: 0, expiryAlerts: 0, lowStockAlerts: 0, transcriptsPurged: 0 };
  for (const t of tenants) {
    const r = await runTenantChecks(pool, t);
    total.reconciliationProblems += r.reconciliationProblems;
    total.expiryAlerts += r.expiryAlerts;
    total.lowStockAlerts += r.lowStockAlerts;
    total.transcriptsPurged += r.transcriptsPurged;
  }
  return total;
}
