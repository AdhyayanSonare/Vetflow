import { useState } from "react";
import { DataTable } from "@/components/common/DataTable";
import { Page, PageHeader } from "@/components/common/Page";
import { EmptyState, QueryBoundary } from "@/components/common/States";
import { StatusText } from "@/components/common/StatusBadge";
import { dateIST } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePrescriptions, type PrescriptionRow } from "./api";

const TABS = [
  { key: "", label: "All" },
  { key: "draft", label: "Needs approval" },
  { key: "approved", label: "Approved" },
  { key: "cancelled", label: "Cancelled" },
];

export default function PrescriptionsPage() {
  const [status, setStatus] = useState("");
  const list = usePrescriptions(status || undefined);
  return (
    <Page>
      <PageHeader title="Prescriptions" description="Drafts wait for a vet to approve them. Approved prescriptions go to the pharmacy." />
      <div role="tablist" aria-label="Filter by status" className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {TABS.map(t => (
          <button key={t.key} role="tab" aria-selected={status === t.key} onClick={() => setStatus(t.key)}
            className={cn("min-h-11 shrink-0 rounded-full border px-4 text-[15px]", status === t.key ? "border-primary bg-tint font-medium text-primary" : "border-border bg-card text-muted-foreground")}>{t.label}</button>
        ))}
      </div>
      <QueryBoundary query={list} empty={{ when: r => r.length === 0, element: <EmptyState title="No prescriptions here" description="Prescriptions appear when a consultation reaches the prescription step." /> }}>
        {rows => (
          <DataTable<PrescriptionRow>
            caption="Prescriptions" rows={rows} rowKey={r => r.id} href={r => `/prescriptions/${r.id}`}
            columns={[
              { key: "patient", header: "Patient", primary: true, cell: r => <span>{r.animalName}<span className="block text-sm font-normal text-muted-foreground">{r.species} · {r.ownerName}</span></span> },
              { key: "status", header: "Status", cell: r => <StatusText status={r.status} /> },
              { key: "vet", header: "Vet", cell: r => r.vetName },
              { key: "lines", header: "Medicines", cell: r => <span className="num">{r.lineCount}</span>, align: "right" },
              { key: "date", header: "Date", cell: r => dateIST(r.approvedAt ?? r.createdAt) },
            ]}
          />
        )}
      </QueryBoundary>
    </Page>
  );
}
