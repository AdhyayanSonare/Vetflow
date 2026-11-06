import { Receipt } from "lucide-react";
import { useState } from "react";
import { useSearch } from "wouter";
import { DataTable } from "@/components/common/DataTable";
import { Page, PageHeader } from "@/components/common/Page";
import { EmptyState, QueryBoundary } from "@/components/common/States";
import { StatusText } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/AuthProvider";
import { usePrescriptions, type PrescriptionRow } from "@/features/prescriptions/api";
import { dateTimeIST } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDispenses, type DispenseRow } from "./api";
import { CounterSaleDialog } from "./CounterSaleDialog";
import { DispenseDialog } from "./DispenseDialog";

/**
 * The pharmacy's work: approved prescriptions waiting to be dispensed, and the history. Stock leaves
 * only when a dispense is confirmed. An approved prescription alone changes nothing.
 */
export default function DispensingPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<"ready" | "history">("ready");
  const preset = new URLSearchParams(useSearch()).get("rx");
  const [rxId, setRxId] = useState<string | null>(preset);
  const [counter, setCounter] = useState(false);
  const approved = usePrescriptions("approved");
  const history = useDispenses("confirmed");

  return (
    <Page>
      <PageHeader title="Dispensing" description="Hand out what the vet has approved. Stock is taken from the earliest-expiring batch first."
        actions={can("dispense.counter") ? <Button variant="secondary" onClick={() => setCounter(true)}><Receipt /> Counter sale</Button> : undefined} />
      <div role="tablist" aria-label="Dispensing" className="mb-4 flex gap-2">
        {([["ready", "Ready to dispense"], ["history", "History"]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("min-h-11 rounded-full border px-4 text-[15px]", tab === k ? "border-primary bg-tint font-medium text-primary" : "border-border bg-card text-muted-foreground")}>{label}</button>
        ))}
      </div>

      {tab === "ready" ? (
        <QueryBoundary query={approved} empty={{ when: r => r.filter(x => x.openLines > 0).length === 0, element: <EmptyState title="Nothing waiting" description="Approved prescriptions appear here until everything on them has been dispensed." /> }}>
          {rows => (
            <DataTable<PrescriptionRow> caption="Prescriptions ready to dispense" rows={rows.filter(r => r.openLines > 0)} rowKey={r => r.id} onRowClick={r => setRxId(r.id)}
              columns={[
                { key: "patient", header: "Patient", primary: true, cell: r => <span>{r.animalName}<span className="block text-sm font-normal text-muted-foreground">{r.ownerName}</span></span> },
                { key: "vet", header: "Prescribed by", cell: r => r.vetName },
                { key: "open", header: "Still to dispense", cell: r => <span className="num">{r.openLines} of {r.lineCount}</span>, align: "right" },
                { key: "date", header: "Approved", cell: r => dateTimeIST(r.approvedAt) },
              ]} />
          )}
        </QueryBoundary>
      ) : (
        <QueryBoundary query={history} empty={{ when: r => r.length === 0, element: <EmptyState title="No dispenses yet" /> }}>
          {rows => (
            <DataTable<DispenseRow> caption="Dispense history" rows={rows} rowKey={r => r.id}
              columns={[
                { key: "who", header: "For", primary: true, cell: r => r.animalName ?? <span>Counter sale<span className="block text-sm font-normal text-muted-foreground">{r.counterReason}</span></span> },
                { key: "status", header: "Status", cell: r => <StatusText status={r.status} /> },
                { key: "when", header: "When", cell: r => dateTimeIST(r.createdAt) },
              ]} />
          )}
        </QueryBoundary>
      )}

      <DispenseDialog prescriptionId={rxId} onClose={() => setRxId(null)} />
      <CounterSaleDialog open={counter} onClose={() => setCounter(false)} />
    </Page>
  );
}
