import { ChevronLeft, Pencil, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Link, useRoute } from "wouter";
import { DataTable } from "@/components/common/DataTable";
import { Section } from "@/components/common/Page";
import { QueryBoundary } from "@/components/common/States";
import { Stat } from "@/components/common/Stat";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/AuthProvider";
import { dateTimeIST, expiryStatus, money, qty } from "@/lib/format";
import { InventoryShell } from "../InventoryShell";
import { AdjustStockDialog } from "./AdjustStockDialog";
import { itemLabel, useItem, useLedger, useStock, type Item, type LedgerRow, type StockRow } from "./api";
import { ItemFormDialog } from "./ItemFormDialog";

function Detail({ item }: { item: Item }) {
  const { can } = useAuth();
  const stock = useStock({ itemId: item.id });
  const ledger = useLedger(item.id, can("audit.read"));
  const [editing, setEditing] = useState(false);
  const [adjusting, setAdjusting] = useState<string | undefined | false>(false);
  const rows = stock.data ?? [];
  const onHand = rows.filter(r => !r.expired).reduce((n, r) => n + r.quantity, 0);
  const expired = rows.filter(r => r.expired).reduce((n, r) => n + r.quantity, 0);
  const value = rows.reduce((n, r) => n + r.quantity * r.unitCostPaise, 0);
  const low = item.minQty > 0 && onHand <= item.minQty;

  return (
    <InventoryShell
      back={<Link href="/inventory" className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" /> Items</Link>}
      title={itemLabel(item)}
      description={<span className="flex flex-wrap items-center gap-2"><span className="num">{item.code}</span>{item.brandName && <span>{item.brandName}</span>}{item.controlled && <StatusBadge tone="warn">Controlled</StatusBadge>}{item.multiDose && <StatusBadge>Multi-dose</StatusBadge>}{!item.active && <StatusBadge>Inactive</StatusBadge>}</span>}
      actions={<>
        {can("stock.adjust") && <Button variant="secondary" onClick={() => setAdjusting(undefined)}><SlidersHorizontal /> Adjust stock</Button>}
        {can("catalogue.write") && <Button variant="secondary" onClick={() => setEditing(true)}><Pencil /> Edit</Button>}
      </>}
    >
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Usable stock" value={qty(onHand, item.unit)} tone={low ? "warn" : "neutral"} note={low ? `At or below the minimum of ${qty(item.minQty)}` : item.minQty ? `Minimum ${qty(item.minQty)}` : "No minimum set"} />
        <Stat label="Stock value" value={money(value, 0)} note="At batch cost" />
        <Stat label="Expired" value={qty(expired, item.unit)} tone={expired ? "danger" : "ok"} note={expired ? "Write off to remove" : "None"} />
        <Stat label="Reorder quantity" value={item.reorderQty ? qty(item.reorderQty) : "—"} note={item.storageLocation ?? "No location set"} />
      </div>

      <Section title="Stock by batch" description="Earliest expiry is used first.">
        <QueryBoundary query={stock} empty={{ when: r => r.length === 0, element: <p className="rounded-xl border border-border bg-card p-4 text-muted-foreground">There is no stock of this item. Receive a delivery to add some.</p> }}>
          {r => (
            <DataTable<StockRow> caption="Stock by batch" rows={r} rowKey={x => `${x.batchId}${x.storeId}`}
              columns={[
                { key: "store", header: "Store", primary: true, cell: x => x.storeName },
                { key: "batch", header: "Batch", cell: x => <span className="num">{x.batchNo}</span> },
                { key: "exp", header: "Expiry", cell: x => { const e = expiryStatus(x.expiryDate); return <StatusBadge tone={e.tone}>{e.label}</StatusBadge>; } },
                { key: "qty", header: "Quantity", align: "right", cell: x => <span className="num">{qty(x.quantity, item.unit)}</span> },
                { key: "cost", header: "Unit cost", align: "right", hideOnPhone: true, cell: x => <span className="num">{money(x.unitCostPaise)}</span> },
                ...(can("stock.adjust") ? [{ key: "act", header: "", align: "right" as const, cell: (x: StockRow) => <Button size="sm" variant="ghost" onClick={() => setAdjusting(x.batchId)}>Adjust</Button> }] : []),
              ]} />
          )}
        </QueryBoundary>
      </Section>

      {can("audit.read") && (
        <Section title="Movement history" description="Every change to this item's stock, with who made it.">
          <QueryBoundary query={ledger} empty={{ when: r => r.length === 0, element: <p className="rounded-xl border border-border bg-card p-4 text-muted-foreground">No movements yet.</p> }}>
            {r => (
              <DataTable<LedgerRow> caption="Movement history" rows={r} rowKey={x => String(x.id)}
                columns={[
                  { key: "when", header: "When", primary: true, cell: x => dateTimeIST(x.at) },
                  { key: "type", header: "Type", cell: x => <span className="capitalize">{x.type.replace(/_/g, " ")}{x.override && <StatusBadge tone="danger" className="ml-1">Override</StatusBadge>}</span> },
                  { key: "qty", header: "Quantity", align: "right", cell: x => <span className="num">{qty(x.quantity)}</span> },
                  { key: "route", header: "Moved", hideOnPhone: true, cell: x => [x.fromStore, x.toStore].filter(Boolean).join(" → ") || "—" },
                  { key: "user", header: "By", cell: x => x.userName ?? "System" },
                  { key: "reason", header: "Reason", hideOnPhone: true, cell: x => x.reason ?? "" },
                ]} />
            )}
          </QueryBoundary>
        </Section>
      )}

      <ItemFormDialog open={editing} onOpenChange={setEditing} item={item} />
      <AdjustStockDialog item={item} rows={rows} open={adjusting !== false} presetBatchId={adjusting || undefined} onClose={() => setAdjusting(false)} />
    </InventoryShell>
  );
}

export default function ItemDetailPage() {
  const [, params] = useRoute<{ id: string }>("/inventory/items/:id");
  const q = useItem(params?.id ?? "");
  return <QueryBoundary query={q}>{item => <Detail item={item} />}</QueryBoundary>;
}
