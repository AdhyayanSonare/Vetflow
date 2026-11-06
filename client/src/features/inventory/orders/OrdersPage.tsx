import { Loader2, Plus, Trash2, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { errorMessage } from "@/api/client";
import { DataTable } from "@/components/common/DataTable";
import { NativeSelect, TextField } from "@/components/common/Fields";
import { DialogActions, ResponsiveDialog } from "@/components/common/ResponsiveDialog";
import { EmptyState, QueryBoundary } from "@/components/common/States";
import { StatusText } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { dateIST, money } from "@/lib/format";
import { parseRupees } from "@/lib/money";
import { cn } from "@/lib/utils";
import { InventoryShell } from "../InventoryShell";
import { itemLabel, useStores, type Item } from "../items/api";
import { ItemPicker } from "../items/ItemPicker";
import { useSuppliers } from "../suppliers/api";
import { useCreateOrder, useOrders, useOrdersFromLowStock, type OrderRow } from "./api";

type Row = { key: string; item: Item; quantity: string; cost: string };

function NewOrderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [, navigate] = useLocation();
  const suppliers = useSuppliers();
  const stores = useStores();
  const create = useCreateOrder();
  const usable = useMemo(() => (stores.data ?? []).filter(s => s.kind !== "transit" && s.active), [stores.data]);
  const [supplierId, setSupplierId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [expected, setExpected] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = !!supplierId && rows.length > 0 && rows.every(r => Number(r.quantity) > 0 && (r.cost === "" || parseRupees(r.cost) !== null));
  const reset = () => { setSupplierId(""); setRows([]); setExpected(""); setNotes(""); setError(null); setPicking(false); };
  const close = () => { reset(); onClose(); };

  const submit = async () => {
    setError(null);
    try {
      const o = await create.mutateAsync({ supplierId, storeId: storeId || usable[0].id, expectedDate: expected || undefined, notes: notes.trim() || undefined,
        lines: rows.map(r => ({ itemId: r.item.id, quantity: Number(r.quantity), unitCostPaise: r.cost ? parseRupees(r.cost)! : 0 })) });
      toast.success(`Order ${o.number} saved as a draft.`);
      close(); navigate(`/inventory/orders/${o.id}`);
    } catch (e) { setError(errorMessage(e)); }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={o => { if (!o) close(); }} size="lg" title="New purchase order" description="Save it as a draft, then send it when it is ready.">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <NativeSelect label="Supplier" required value={supplierId} onChange={e => setSupplierId(e.target.value)}><option value="">Choose a supplier</option>{suppliers.data?.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect>
          <NativeSelect label="Deliver to" value={storeId || usable[0]?.id || ""} onChange={e => setStoreId(e.target.value)}>{usable.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect>
          <TextField label="Expected on" type="date" value={expected} onChange={e => setExpected(e.target.value)} />
          <TextField label="Note to the supplier" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
        <ul className="space-y-2">{rows.map(r => (
          <li key={r.key} className="grid grid-cols-[1fr_6rem_6rem_auto] items-end gap-2 rounded-lg border border-border p-2">
            <p className="min-w-0 self-center break-words font-medium">{itemLabel(r.item)}</p>
            <TextField label="Qty" inputMode="decimal" className="num" value={r.quantity} onChange={e => setRows(rs => rs.map(x => (x.key === r.key ? { ...x, quantity: e.target.value } : x)))} />
            <TextField label="₹ each" inputMode="decimal" className="num" value={r.cost} onChange={e => setRows(rs => rs.map(x => (x.key === r.key ? { ...x, cost: e.target.value } : x)))} />
            <Button variant="ghost" size="icon-sm" aria-label={`Remove ${itemLabel(r.item)}`} onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))}><Trash2 /></Button>
          </li>))}</ul>
        {picking ? <ItemPicker autoFocus showStock={false} onPick={item => { setRows(rs => [...rs, { key: item.id, item, quantity: String(item.reorderQty || 1), cost: "" }]); setPicking(false); }} />
          : <Button variant="secondary" onClick={() => setPicking(true)}><Plus /> Add an item</Button>}
        {error && <p role="alert" className="rounded-md bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p>}
        <DialogActions><Button variant="secondary" onClick={close}>Cancel</Button><Button disabled={!valid || create.isPending} onClick={() => void submit()}>{create.isPending && <Loader2 className="animate-spin" />}Save draft order</Button></DialogActions>
      </div>
    </ResponsiveDialog>
  );
}

function LowStockDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const stores = useStores();
  const make = useOrdersFromLowStock();
  const usable = (stores.data ?? []).filter(s => s.kind !== "transit" && s.active);
  const [storeId, setStoreId] = useState("");
  const [result, setResult] = useState<{ created: string[]; skipped: Array<{ name: string; reason: string }> } | null>(null);
  const go = async () => { try { setResult(await make.mutateAsync({ storeId: storeId || usable[0].id })); } catch (e) { toast.error(errorMessage(e)); } };
  return (
    <ResponsiveDialog open={open} onOpenChange={o => { if (!o) { setResult(null); onClose(); } }} title="Order what is running low" description="Makes one draft order per usual supplier, for every item at or below its minimum.">
      {!result ? (
        <div className="space-y-4">
          <NativeSelect label="Deliver to" value={storeId || usable[0]?.id || ""} onChange={e => setStoreId(e.target.value)}>{usable.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect>
          <DialogActions><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={make.isPending} onClick={() => void go()}>{make.isPending && <Loader2 className="animate-spin" />}Create draft orders</Button></DialogActions>
        </div>
      ) : (
        <div className="space-y-3">
          <p>{result.created.length === 0 ? "Nothing needed ordering." : `${result.created.length} draft ${result.created.length === 1 ? "order" : "orders"} created. Review and send them from the list.`}</p>
          {result.skipped.length > 0 && <div className="rounded-md bg-warn-tint p-3 text-sm text-warn"><p className="font-medium">Skipped, with no usual supplier set:</p><ul className="mt-1 list-disc pl-5">{result.skipped.map(s => <li key={s.name}>{s.name}</li>)}</ul></div>}
          <DialogActions><Button onClick={() => { setResult(null); onClose(); }}>Done</Button></DialogActions>
        </div>
      )}
    </ResponsiveDialog>
  );
}

const TABS = [{ key: "", label: "All" }, { key: "draft", label: "Drafts" }, { key: "sent", label: "Sent" }, { key: "partially_received", label: "Part received" }, { key: "received", label: "Received" }];

export default function OrdersPage() {
  const [status, setStatus] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [lowOpen, setLowOpen] = useState(false);
  const list = useOrders(status || undefined);
  return (
    <InventoryShell title="Purchase orders" description="What you have asked suppliers for, and what has arrived so far."
      actions={<><Button variant="secondary" onClick={() => setLowOpen(true)}><Wand2 /> From low stock</Button><Button onClick={() => setNewOpen(true)}><Plus /> New order</Button></>}>
      <div role="tablist" aria-label="Filter orders" className="mb-4 flex gap-2 overflow-x-auto">
        {TABS.map(t => <button key={t.key} role="tab" aria-selected={status === t.key} onClick={() => setStatus(t.key)} className={cn("min-h-11 shrink-0 rounded-full border px-4 text-[15px]", status === t.key ? "border-primary bg-tint font-medium text-primary" : "border-border bg-card text-muted-foreground")}>{t.label}</button>)}
      </div>
      <QueryBoundary query={list} empty={{ when: r => r.length === 0, element: <EmptyState title="No purchase orders" description="Create one, or let Vetflow draft orders for items running low." /> }}>
        {rows => (
          <DataTable<OrderRow> caption="Purchase orders" rows={rows} rowKey={o => o.id} href={o => `/inventory/orders/${o.id}`}
            columns={[
              { key: "no", header: "Order", primary: true, cell: o => <span><span className="num">{o.number}</span><span className="block text-sm font-normal text-muted-foreground">{o.supplierName}</span></span> },
              { key: "status", header: "Status", cell: o => <StatusText status={o.status} /> },
              { key: "value", header: "Value", align: "right", cell: o => <span className="num">{o.valuePaise ? money(o.valuePaise) : "—"}</span> },
              { key: "exp", header: "Expected", hideOnPhone: true, cell: o => (o.expectedDate ? dateIST(o.expectedDate) : "—") },
            ]} />
        )}
      </QueryBoundary>
      <NewOrderDialog open={newOpen} onClose={() => setNewOpen(false)} />
      <LowStockDialog open={lowOpen} onClose={() => setLowOpen(false)} />
    </InventoryShell>
  );
}
