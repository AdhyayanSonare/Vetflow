import { Plus } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { DataTable } from "@/components/common/DataTable";
import { SearchInput } from "@/components/common/SearchInput";
import { EmptyState, QueryBoundary } from "@/components/common/States";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/AuthProvider";
import { useDebounce } from "@/hooks/useMedia";
import { qty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { InventoryShell } from "../InventoryShell";
import { BarcodeScanButton } from "./BarcodeScanButton";
import { itemLabel, useItems, type Item } from "./api";
import { ItemFormDialog } from "./ItemFormDialog";

const FILTERS = [{ key: "all", label: "All" }, { key: "low", label: "Low stock" }, { key: "out", label: "Out of stock" }, { key: "inactive", label: "Inactive" }];

export function stockState(i: Item): { tone: "ok" | "warn" | "danger"; label: string } {
  const on = i.onHand ?? 0;
  if (on <= 0) return { tone: "danger", label: "Out of stock" };
  if (i.minQty > 0 && on <= i.minQty) return { tone: "warn", label: "Low" };
  return { tone: "ok", label: "In stock" };
}

export default function ItemsPage() {
  const { can, features } = useAuth();
  const [, navigate] = useLocation();
  const [text, setText] = useState("");
  const [filter, setFilter] = useState("all");
  const [adding, setAdding] = useState(false);
  const q = useDebounce(text.trim(), 250);
  const items = useItems({ q, limit: 200, includeInactive: filter === "inactive" });

  const rows = (items.data ?? []).filter(i => filter === "inactive" ? !i.active : filter === "low" ? stockState(i).label === "Low" : filter === "out" ? (i.onHand ?? 0) <= 0 : i.active);

  return (
    <InventoryShell title="Items" description="Everything the clinics stock. Search by name, code or barcode."
      actions={can("catalogue.write") ? <Button onClick={() => setAdding(true)}><Plus /> Add item</Button> : undefined}>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex gap-2 md:w-96"><SearchInput value={text} onChange={setText} placeholder="Search items" wrapperClassName="flex-1" />{features.barcode && <BarcodeScanButton onScan={setText} />}</div>
        <div role="tablist" aria-label="Filter items" className="flex gap-2 overflow-x-auto">
          {FILTERS.map(f => <button key={f.key} role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)} className={cn("min-h-11 shrink-0 rounded-full border px-4 text-[15px]", filter === f.key ? "border-primary bg-tint font-medium text-primary" : "border-border bg-card text-muted-foreground")}>{f.label}</button>)}
        </div>
      </div>

      <QueryBoundary query={items} empty={{ when: () => rows.length === 0, element: <EmptyState title={q ? `No items match “${q}”` : "No items here"} description={q ? "Check the spelling, or search by code or barcode." : "Add an item, or import your list from Excel."} action={can("catalogue.write") ? <Button onClick={() => setAdding(true)}><Plus /> Add item</Button> : undefined} /> }}>
        {() => (
          <DataTable<Item> caption="Items" rows={rows} rowKey={i => i.id} href={i => `/inventory/items/${i.id}`}
            columns={[
              { key: "name", header: "Item", primary: true, cell: i => <span>{itemLabel(i)}{i.controlled && <StatusBadge tone="warn" className="ml-2">Controlled</StatusBadge>}<span className="num block text-sm font-normal text-muted-foreground">{i.code}{i.storageLocation ? ` · ${i.storageLocation}` : ""}</span></span> },
              { key: "onHand", header: "On hand", align: "right", cell: i => <span className="num">{qty(i.onHand ?? 0, i.unit)}</span> },
              { key: "min", header: "Minimum", align: "right", hideOnPhone: true, cell: i => <span className="num text-muted-foreground">{i.minQty ? qty(i.minQty) : "—"}</span> },
              { key: "state", header: "Status", cell: i => i.active ? (() => { const s = stockState(i); return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>; })() : <StatusBadge>Inactive</StatusBadge> },
            ]} />
        )}
      </QueryBoundary>
      <ItemFormDialog open={adding} onOpenChange={setAdding} onSaved={i => navigate(`/inventory/items/${i.id}`)} />
    </InventoryShell>
  );
}
