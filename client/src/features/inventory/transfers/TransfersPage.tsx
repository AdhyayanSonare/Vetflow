import { ArrowRight, Loader2, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { errorMessage } from "@/api/client";
import { DataTable } from "@/components/common/DataTable";
import { NativeSelect, TextField } from "@/components/common/Fields";
import { DialogActions, ResponsiveDialog } from "@/components/common/ResponsiveDialog";
import { EmptyState, QueryBoundary } from "@/components/common/States";
import { StatusBadge, StatusText } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { dateIST } from "@/lib/format";
import { cn } from "@/lib/utils";
import { InventoryShell } from "../InventoryShell";
import { itemLabel, useStores, type Item } from "../items/api";
import { ItemPicker } from "../items/ItemPicker";
import { useCreateTransfer, useTransfers, type TransferRow } from "./api";

type Row = { item: Item; quantity: string };

function NewTransferDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [, navigate] = useLocation();
  const stores = useStores();
  const create = useCreateTransfer();
  const usable = useMemo(() => (stores.data ?? []).filter(s => s.kind !== "transit" && s.active), [stores.data]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fromId = from || usable.find(s => s.kind === "central")?.id || usable[0]?.id || "";
  const toId = to || usable.find(s => s.id !== fromId)?.id || "";
  const valid = !!fromId && !!toId && fromId !== toId && rows.length > 0 && rows.every(r => Number(r.quantity) > 0);
  const close = () => { setRows([]); setError(null); setPicking(false); onClose(); };

  const submit = async () => {
    setError(null);
    try {
      const t = await create.mutateAsync({ fromStoreId: fromId, toStoreId: toId, lines: rows.map(r => ({ itemId: r.item.id, quantity: Number(r.quantity) })) });
      toast.success("Transfer drafted. Dispatch it when the goods leave.");
      close(); navigate(`/inventory/transfers/${t.id}`);
    } catch (e) { setError(errorMessage(e)); }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={o => { if (!o) close(); }} size="lg" title="New transfer" description="Move stock between stores. Batches are chosen earliest-expiry first when you dispatch.">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <NativeSelect label="From" value={fromId} onChange={e => setFrom(e.target.value)}>{usable.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect>
          <NativeSelect label="To" value={toId} onChange={e => setTo(e.target.value)} error={fromId === toId ? "Choose a different store." : undefined}>{usable.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect>
        </div>
        <ul className="space-y-2">{rows.map(r => (
          <li key={r.item.id} className="grid grid-cols-[1fr_7rem_auto] items-end gap-2 rounded-lg border border-border p-2">
            <p className="min-w-0 self-center break-words font-medium">{itemLabel(r.item)}<span className="block text-sm font-normal text-muted-foreground">{r.item.onHand != null ? `${r.item.onHand} ${r.item.unit} in stock overall` : ""}</span></p>
            <TextField label={`Qty (${r.item.unit})`} inputMode="decimal" className="num" value={r.quantity} onChange={e => setRows(rs => rs.map(x => (x.item.id === r.item.id ? { ...x, quantity: e.target.value } : x)))} />
            <Button variant="ghost" size="icon-sm" aria-label={`Remove ${itemLabel(r.item)}`} onClick={() => setRows(rs => rs.filter(x => x.item.id !== r.item.id))}><Trash2 /></Button>
          </li>))}</ul>
        {picking ? <ItemPicker autoFocus onPick={item => { setRows(rs => rs.some(x => x.item.id === item.id) ? rs : [...rs, { item, quantity: "" }]); setPicking(false); }} />
          : <Button variant="secondary" onClick={() => setPicking(true)}><Plus /> Add an item</Button>}
        {error && <p role="alert" className="rounded-md bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p>}
        <DialogActions><Button variant="secondary" onClick={close}>Cancel</Button><Button disabled={!valid || create.isPending} onClick={() => void submit()}>{create.isPending && <Loader2 className="animate-spin" />}Save draft transfer</Button></DialogActions>
      </div>
    </ResponsiveDialog>
  );
}

const TABS = [{ key: "", label: "All" }, { key: "draft", label: "Drafts" }, { key: "dispatched", label: "In transit" }, { key: "received", label: "Received" }];

export default function TransfersPage() {
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);
  const list = useTransfers(status || undefined);
  return (
    <InventoryShell title="Transfers" description="Stock moving between your stores and branches. A transfer is never counted as use."
      actions={<Button onClick={() => setOpen(true)}><Plus /> New transfer</Button>}>
      <div role="tablist" aria-label="Filter transfers" className="mb-4 flex gap-2 overflow-x-auto">
        {TABS.map(t => <button key={t.key} role="tab" aria-selected={status === t.key} onClick={() => setStatus(t.key)} className={cn("min-h-11 shrink-0 rounded-full border px-4 text-[15px]", status === t.key ? "border-primary bg-tint font-medium text-primary" : "border-border bg-card text-muted-foreground")}>{t.label}</button>)}
      </div>
      <QueryBoundary query={list} empty={{ when: r => r.length === 0, element: <EmptyState title="No transfers" /> }}>
        {rows => (
          <DataTable<TransferRow> caption="Transfers" rows={rows} rowKey={t => t.id} href={t => `/inventory/transfers/${t.id}`}
            columns={[
              { key: "route", header: "Route", primary: true, cell: t => <span className="inline-flex flex-wrap items-center gap-1">{t.fromStore} <ArrowRight className="size-4 text-muted-foreground" /> {t.toStore}</span> },
              { key: "status", header: "Status", cell: t => <span className="inline-flex flex-wrap gap-1"><StatusText status={t.status} />{t.hasDiscrepancy && <StatusBadge tone="danger">Short</StatusBadge>}</span> },
              { key: "date", header: "Created", cell: t => dateIST(t.createdAt) },
            ]} />
        )}
      </QueryBoundary>
      <NewTransferDialog open={open} onClose={() => setOpen(false)} />
    </InventoryShell>
  );
}
