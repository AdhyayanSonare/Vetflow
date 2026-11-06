import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Wand2 } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { api, errorMessage } from "@/api/client";
import { DataTable } from "@/components/common/DataTable";
import { Section } from "@/components/common/Page";
import { QueryBoundary } from "@/components/common/States";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/AuthProvider";
import { dashboardKeys, useAlerts, type Alert } from "@/features/dashboard/api";
import { dateIST, dateTimeIST, expiryStatus, qty } from "@/lib/format";
import { InventoryShell } from "../InventoryShell";
import { useLowStock, type LowStockRow } from "../items/api";

type Expiring = { itemId: string; itemName: string; batchId: string; batchNo: string; expiryDate: string; daysLeft: number; quantity: number; expired: boolean };
const useExpiring = (days: number) => useQuery({ queryKey: ["expiring", days], queryFn: () => api.get<Expiring[]>("/api/expiring", { days }) });

export default function AlertsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const alerts = useAlerts();
  const low = useLowStock();
  const [days, setDays] = useState(90);
  const expiring = useExpiring(days);
  const resolve = useMutation({ mutationFn: (id: string) => api.post(`/api/alerts/${id}/resolve`), onSuccess: () => { void qc.invalidateQueries({ queryKey: dashboardKeys.alerts() }); void qc.invalidateQueries({ queryKey: dashboardKeys.alerts(true) }); } });

  return (
    <InventoryShell title="Alerts" description="Low stock, batches about to expire, and anything the nightly check found that does not add up.">
      <Section title="Open alerts">
        <QueryBoundary query={alerts} rows={2} empty={{ when: a => a.length === 0, element: <p className="rounded-xl border border-border bg-card p-4 text-muted-foreground">Nothing needs attention right now.</p> }}>
          {rows => (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {rows.map((a: Alert) => (
                <li key={a.id} className="flex flex-wrap items-start gap-3 p-4">
                  <AlertTriangle className={`mt-0.5 size-5 shrink-0 ${a.severity === "critical" ? "text-danger" : "text-warn"}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1"><p className="break-words">{a.message}</p><p className="text-sm text-muted-foreground">{dateTimeIST(a.createdAt)}</p></div>
                  <StatusBadge tone={a.severity === "critical" ? "danger" : a.severity === "warning" ? "warn" : "neutral"}>{a.severity === "critical" ? "Critical" : a.severity === "warning" ? "Warning" : "Info"}</StatusBadge>
                  {can("stock.adjust") && <Button size="sm" variant="ghost" disabled={resolve.isPending} onClick={() => resolve.mutate(a.id, { onError: e => toast.error(errorMessage(e)) })}><Check /> Resolve</Button>}
                </li>
              ))}
            </ul>
          )}
        </QueryBoundary>
      </Section>

      <Section title="Low stock" description="At or below the minimum you set for each item."
        actions={can("purchase.write") ? <Button asChild variant="secondary" size="sm"><Link href="/inventory/orders"><Wand2 /> Order these</Link></Button> : undefined}>
        <QueryBoundary query={low} rows={2} empty={{ when: r => r.length === 0, element: <p className="rounded-xl border border-border bg-card p-4 text-muted-foreground">Every item is above its minimum.</p> }}>
          {rows => (
            <DataTable<LowStockRow> caption="Low stock" rows={rows} rowKey={r => r.itemId} href={r => `/inventory/items/${r.itemId}`}
              columns={[
                { key: "item", header: "Item", primary: true, cell: r => <span>{r.itemName}<span className="num block text-sm font-normal text-muted-foreground">{r.code}</span></span> },
                { key: "on", header: "On hand", align: "right", cell: r => <span className="num text-danger">{qty(r.onHand, r.unit)}</span> },
                { key: "min", header: "Minimum", align: "right", hideOnPhone: true, cell: r => <span className="num">{qty(r.minQty)}</span> },
                { key: "re", header: "Suggested order", align: "right", cell: r => <span className="num">{qty(r.suggestedReorder, r.unit)}</span> },
              ]} />
          )}
        </QueryBoundary>
      </Section>

      <Section title="Expiring batches" actions={
        <div role="group" aria-label="Look ahead" className="flex gap-1">{[30, 60, 90].map(d => <Button key={d} size="sm" variant={days === d ? "default" : "secondary"} aria-pressed={days === d} onClick={() => setDays(d)}>{d} days</Button>)}</div>}>
        <QueryBoundary query={expiring} rows={2} empty={{ when: r => r.length === 0, element: <p className="rounded-xl border border-border bg-card p-4 text-muted-foreground">No batches expire in the next {days} days.</p> }}>
          {rows => (
            <DataTable<Expiring> caption="Expiring batches" rows={rows} rowKey={r => r.batchId} href={r => `/inventory/items/${r.itemId}`}
              columns={[
                { key: "item", header: "Item", primary: true, cell: r => <span>{r.itemName}<span className="num block text-sm font-normal text-muted-foreground">Batch {r.batchNo}</span></span> },
                { key: "exp", header: "Expiry", cell: r => { const e = expiryStatus(r.expiryDate); return <span className="inline-flex flex-wrap items-center gap-1">{dateIST(r.expiryDate)}<StatusBadge tone={e.tone}>{r.expired ? "Expired" : e.label}</StatusBadge></span>; } },
                { key: "q", header: "Quantity", align: "right", cell: r => <span className="num">{qty(r.quantity)}</span> },
              ]} />
          )}
        </QueryBoundary>
      </Section>
    </InventoryShell>
  );
}
