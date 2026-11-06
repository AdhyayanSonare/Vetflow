import { AlertTriangle, CalendarClock, Package, PackageX, Stethoscope } from "lucide-react";
import { Link } from "wouter";
import { Page, PageHeader, Section } from "@/components/common/Page";
import { Stat } from "@/components/common/Stat";
import { StatusBadge } from "@/components/common/StatusBadge";
import { QueryBoundary } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/AuthProvider";
import { count, dateTimeIST, money, qty, timeIST } from "@/lib/format";
import { useAlerts, useDashboard, type Alert } from "./api";
import { ConsumptionChart } from "./ConsumptionChart";

const greeting = (now = new Date()) => {
  const h = Number(timeIST(now).slice(0, 2));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

const SEVERITY: Record<Alert["severity"], "danger" | "warn" | "neutral"> = { critical: "danger", warning: "warn", info: "neutral" };

function AlertList({ alerts }: { alerts: Alert[] }) {
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
      {alerts.slice(0, 6).map(a => (
        <li key={a.id} className="flex items-start gap-3 p-3.5">
          <AlertTriangle className={`mt-0.5 size-5 shrink-0 ${a.severity === "critical" ? "text-danger" : "text-warn"}`} aria-hidden="true" />
          <div className="min-w-0 flex-1"><p className="break-words">{a.message}</p><p className="mt-0.5 text-sm text-muted-foreground">{dateTimeIST(a.createdAt)}</p></div>
          <StatusBadge tone={SEVERITY[a.severity]}>{a.severity === "critical" ? "Critical" : a.severity === "warning" ? "Warning" : "Info"}</StatusBadge>
        </li>
      ))}
    </ul>
  );
}

export default function TodayPage() {
  const { user, can } = useAuth();
  const showStock = can("reports.read");
  const dash = useDashboard(showStock);
  const alerts = useAlerts({ enabled: can("catalogue.read") });
  const first = user?.name.replace(/^Dr\.?\s+/i, "").split(" ")[0] ?? "";

  return (
    <Page>
      <PageHeader
        title={`${greeting()}, ${first}`}
        description="Here is what needs attention across your clinics."
        actions={can("clinical.write") ? <Button asChild size="lg"><Link href="/consult/new"><Stethoscope /> New consultation</Link></Button> : undefined}
      />

      {showStock && (
        <Section>
          <QueryBoundary query={dash} rows={2}>
            {d => (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Stock value" value={money(d.stockValuePaise, 0)} note={`${count(d.itemsInStock)} items in stock`} icon={<Package className="size-4" />} href="/reports" />
                <Stat label="Low stock" value={count(d.lowStock)} tone={d.lowStock ? "warn" : "ok"} note={d.lowStock ? "At or below minimum" : "All above minimum"} href="/inventory/alerts" icon={<PackageX className="size-4" />} />
                <Stat label="Expiring in 30 days" value={count(d.expiring30)} tone={d.expiring30 ? "danger" : "ok"} note={`${count(d.expiring60)} more by 60 days`} href="/reports" icon={<CalendarClock className="size-4" />} />
                <Stat label="Expired batches" value={count(d.expiredBatches)} tone={d.expiredBatches ? "danger" : "ok"} note={d.pendingPurchases ? `${count(d.pendingPurchases)} purchases to confirm` : "Nothing to confirm"} href="/inventory/receipts" />
              </div>
            )}
          </QueryBoundary>
        </Section>
      )}

      {can("catalogue.read") && (
        <Section title="Needs attention" actions={<Button asChild variant="ghost" size="sm"><Link href="/inventory/alerts">All alerts</Link></Button>}>
          <QueryBoundary query={alerts} rows={2} empty={{ when: a => a.length === 0, element: <p className="rounded-xl border border-border bg-card p-4 text-muted-foreground">Nothing needs attention right now.</p> }}>
            {a => <AlertList alerts={a} />}
          </QueryBoundary>
        </Section>
      )}

      {showStock && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Most used items" description="By quantity, all time">
            <QueryBoundary query={dash} rows={2} empty={{ when: d => d.topConsumed.length === 0, element: <p className="rounded-xl border border-border bg-card p-4 text-muted-foreground">No stock has been used yet.</p> }}>
              {d => <ConsumptionChart data={d.topConsumed.map(t => ({ name: t.item, value: t.quantity }))} />}
            </QueryBoundary>
          </Section>
          <Section title="Recent stock movements">
            <QueryBoundary query={dash} rows={3}>
              {d => (
                <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                  {d.recentMovements.map(m => (
                    <li key={m.id} className="flex items-center justify-between gap-3 p-3.5">
                      <div className="min-w-0"><p className="truncate font-medium">{m.item}</p><p className="truncate text-sm text-muted-foreground">{m.type.replace(/_/g, " ")} · {m.user ?? "System"} · {dateTimeIST(m.at)}</p></div>
                      <span className="num shrink-0">{qty(m.quantity)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </QueryBoundary>
          </Section>
        </div>
      )}
    </Page>
  );
}
