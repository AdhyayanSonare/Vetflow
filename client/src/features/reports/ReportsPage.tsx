import { useState } from "react";
import { NativeSelect, TextField } from "@/components/common/Fields";
import { Page, PageHeader } from "@/components/common/Page";
import { useAuth } from "@/features/auth/AuthProvider";
import { useStores } from "@/features/inventory/items/api";
import { addDays, todayIST } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ReportView, type ReportFilters } from "./ReportView";

type Def = { key: string; label: string; about: string; filters: Array<"dates" | "asOf" | "store" | "days">; adminOnly?: boolean };

const REPORTS: Def[] = [
  { key: "current-stock", label: "Current stock", about: "What is in each store, by batch. Pick a date to see it as it was.", filters: ["asOf", "store"] },
  { key: "valuation", label: "Valuation", about: "Stock value at the actual cost of each batch.", filters: ["store"] },
  { key: "movements", label: "Movements", about: "Every change to stock, with who made it and why.", filters: ["dates", "store"] },
  { key: "expiry", label: "Expiry", about: "Batches that have expired or will soon.", filters: ["days", "store"] },
  { key: "low-stock", label: "Low stock", about: "Items at or below their minimum, with a suggested reorder.", filters: [] },
  { key: "purchases", label: "Purchases", about: "What was bought, from whom, and at what cost.", filters: ["dates"] },
  { key: "consumption", label: "Consumption", about: "What was dispensed or issued, by item and department.", filters: ["dates", "store"] },
  { key: "wastage", label: "Wastage", about: "Damaged and expired stock written off.", filters: ["dates", "store"] },
  { key: "audit", label: "Audit log", about: "Who did what, and when.", filters: ["dates"], adminOnly: true },
];

export default function ReportsPage() {
  const { user } = useAuth();
  const stores = useStores();
  const [key, setKey] = useState(REPORTS[0].key);
  const [f, setF] = useState<ReportFilters>({ from: addDays(todayIST(), -30), to: todayIST(), days: 90 });
  const defs = REPORTS.filter(r => !r.adminOnly || user?.role === "admin" || user?.role === "inventory_manager");
  const def = defs.find(r => r.key === key) ?? defs[0];
  const pick = <K extends keyof ReportFilters>(k: K, v: ReportFilters[K]) => setF(s => ({ ...s, [k]: v || undefined }));

  // Only the filters this report understands are sent, so exports match what is shown.
  const active: ReportFilters = {
    ...(def.filters.includes("dates") ? { from: f.from, to: f.to } : {}), ...(def.filters.includes("asOf") ? { asOf: f.asOf } : {}),
    ...(def.filters.includes("store") ? { storeId: f.storeId } : {}), ...(def.filters.includes("days") ? { days: f.days } : {}),
  };

  return (
    <Page wide>
      <PageHeader title="Reports" description={def.about} />
      <div role="tablist" aria-label="Choose a report" className="no-print -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
        {defs.map(r => <button key={r.key} role="tab" aria-selected={def.key === r.key} onClick={() => setKey(r.key)} className={cn("min-h-11 shrink-0 rounded-full border px-4 text-[15px]", def.key === r.key ? "border-primary bg-tint font-medium text-primary" : "border-border bg-card text-muted-foreground")}>{r.label}</button>)}
      </div>

      {def.filters.length > 0 && (
        <div className="no-print mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          {def.filters.includes("dates") && <><TextField label="From" type="date" value={f.from ?? ""} max={f.to} onChange={e => pick("from", e.target.value)} /><TextField label="To" type="date" value={f.to ?? ""} min={f.from} onChange={e => pick("to", e.target.value)} /></>}
          {def.filters.includes("asOf") && <TextField label="As of (optional)" type="date" value={f.asOf ?? ""} max={todayIST()} onChange={e => pick("asOf", e.target.value)} />}
          {def.filters.includes("days") && <NativeSelect label="Expiring within" value={String(f.days ?? 90)} onChange={e => pick("days", Number(e.target.value))}>{[30, 60, 90, 180, 365].map(d => <option key={d} value={d}>{d} days</option>)}</NativeSelect>}
          {def.filters.includes("store") && <NativeSelect label="Store" value={f.storeId ?? ""} onChange={e => pick("storeId", e.target.value)}><option value="">All stores</option>{stores.data?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect>}
        </div>
      )}
      <ReportView name={def.key} filters={active} />
    </Page>
  );
}
