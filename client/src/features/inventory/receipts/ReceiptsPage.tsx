import { Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { DataTable } from "@/components/common/DataTable";
import { EmptyState, QueryBoundary } from "@/components/common/States";
import { StatusText } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/AuthProvider";
import { dateIST } from "@/lib/format";
import { cn } from "@/lib/utils";
import { InventoryShell } from "../InventoryShell";
import { useReceipts, type ReceiptRow } from "./api";

const TABS = [{ key: "", label: "All" }, { key: "draft", label: "To confirm" }, { key: "confirmed", label: "Confirmed" }];

export default function ReceiptsPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState("");
  const list = useReceipts(status || undefined);
  return (
    <InventoryShell title="Receipts" description="Deliveries from suppliers. Stock goes up only when a receipt is confirmed."
      actions={<Button asChild><Link href="/inventory/receipts/new"><Plus /> New receipt</Link></Button>}>
      <div role="tablist" aria-label="Filter receipts" className="mb-4 flex gap-2">
        {TABS.map(t => <button key={t.key} role="tab" aria-selected={status === t.key} onClick={() => setStatus(t.key)} className={cn("min-h-11 rounded-full border px-4 text-[15px]", status === t.key ? "border-primary bg-tint font-medium text-primary" : "border-border bg-card text-muted-foreground")}>{t.label}</button>)}
      </div>
      <QueryBoundary query={list} empty={{ when: r => r.length === 0, element: <EmptyState title="No receipts" description={can("purchase.write") ? "Record a delivery to add stock." : undefined} /> }}>
        {rows => (
          <DataTable<ReceiptRow> caption="Receipts" rows={rows} rowKey={r => r.id} href={r => `/inventory/receipts/${r.id}`}
            columns={[
              { key: "supplier", header: "Supplier", primary: true, cell: r => <span>{r.supplierName}<span className="block text-sm font-normal text-muted-foreground">{r.invoiceNo ? `Invoice ${r.invoiceNo}` : "No invoice number"}</span></span> },
              { key: "status", header: "Status", cell: r => <StatusText status={r.status} /> },
              { key: "lines", header: "Lines", align: "right", cell: r => <span className="num">{r.lineCount}</span> },
              { key: "date", header: "Entered", cell: r => dateIST(r.createdAt) },
            ]} />
        )}
      </QueryBoundary>
    </InventoryShell>
  );
}
