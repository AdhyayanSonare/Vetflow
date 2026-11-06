import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Droplet, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/api/client";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { DataTable } from "@/components/common/DataTable";
import { NativeSelect, TextField } from "@/components/common/Fields";
import { DialogActions, ResponsiveDialog } from "@/components/common/ResponsiveDialog";
import { SearchInput } from "@/components/common/SearchInput";
import { EmptyState, QueryBoundary } from "@/components/common/States";
import { StatusBadge, StatusText } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/AuthProvider";
import { usePatients } from "@/features/patients/api";
import { useDebounce } from "@/hooks/useMedia";
import { dateIST, qty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { InventoryShell } from "../InventoryShell";
import { itemLabel, useInvalidateStock, useStores, type Item } from "../items/api";
import { ItemPicker } from "../items/ItemPicker";

type Vial = { id: string; itemId: string; itemName: string; batchNo: string; storeId: string; openedAt: string; beyondUseAt: string; pastBeyondUse: boolean; volumeMl: number; remainingMl: number; status: "open" | "empty" | "discarded" };
const useVials = (status: string) => useQuery({ queryKey: ["vials", status], queryFn: () => api.get<Vial[]>("/api/vials", { status }) });

function useVialAction() {
  const invalidate = useInvalidateStock();
  const qc = useQueryClient();
  const done = () => { invalidate(); void qc.invalidateQueries({ queryKey: ["vials"] }); };
  return {
    open: useMutation({ mutationFn: (b: { itemId: string; storeId: string }) => api.post<Vial>("/api/vials/open", b), onSuccess: done }),
    draw: useMutation({ mutationFn: (b: { id: string; ml: number; animalId: string }) => api.post<Vial>(`/api/vials/${b.id}/draw`, { ml: b.ml, animalId: b.animalId }), onSuccess: done }),
    discard: useMutation({ mutationFn: (b: { id: string; reason: string }) => api.post(`/api/vials/${b.id}/discard`, { reason: b.reason }), onSuccess: done }),
  };
}

function DrawDialog({ vial, onClose }: { vial: Vial | null; onClose: () => void }) {
  const { draw } = useVialAction();
  const [ml, setMl] = useState("");
  const [text, setText] = useState("");
  const [animalId, setAnimalId] = useState("");
  const q = useDebounce(text.trim(), 250);
  const patients = usePatients(q);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setError(null);
    try { await draw.mutateAsync({ id: vial!.id, ml: Number(ml), animalId }); toast.success("Dose recorded."); setMl(""); setAnimalId(""); setText(""); onClose(); } catch (e) { setError(errorMessage(e)); }
  };
  return (
    <ResponsiveDialog open={!!vial} onOpenChange={o => { if (!o) onClose(); }} title="Draw a dose" description={vial ? `${vial.itemName} · ${qty(vial.remainingMl)} ml left` : undefined}>
      <div className="space-y-4">
        <TextField label="Amount (ml)" inputMode="decimal" className="num" value={ml} onChange={e => setMl(e.target.value)} />
        <div className="space-y-2">
          <p className="text-[15px] font-medium">For which patient?</p>
          <SearchInput value={text} onChange={setText} placeholder="Search patients" />
          <ul className="max-h-44 space-y-1 overflow-y-auto">{patients.data?.slice(0, 8).map(a => (
            <li key={a.id}><button type="button" onClick={() => setAnimalId(a.id)} aria-pressed={animalId === a.id} className={cn("flex min-h-12 w-full items-center justify-between rounded-md border px-3 text-left", animalId === a.id ? "border-primary bg-tint" : "border-border")}><span className="font-medium">{a.name}</span><span className="text-sm text-muted-foreground">{a.ownerName}</span></button></li>
          ))}</ul>
        </div>
        {error && <p role="alert" className="rounded-md bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p>}
        <DialogActions><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!(Number(ml) > 0) || !animalId || draw.isPending} onClick={() => void go()}>{draw.isPending && <Loader2 className="animate-spin" />}Record dose</Button></DialogActions>
      </div>
    </ResponsiveDialog>
  );
}

function OpenVialDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { open: openVial } = useVialAction();
  const stores = useStores();
  const [item, setItem] = useState<Item | null>(null);
  const [storeId, setStoreId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const usable = (stores.data ?? []).filter(s => s.kind !== "transit" && s.active);
  const go = async () => {
    setError(null);
    try { await openVial.mutateAsync({ itemId: item!.id, storeId: storeId || usable.find(s => s.kind === "branch")?.id || usable[0].id }); toast.success("Vial opened. One sealed vial was taken from stock."); setItem(null); onClose(); } catch (e) { setError(errorMessage(e)); }
  };
  return (
    <ResponsiveDialog open={open} onOpenChange={o => { if (!o) { setItem(null); onClose(); } }} title="Open a vial" description="Takes one sealed vial out of stock. Doses are then drawn from the open vial.">
      <div className="space-y-4">
        <NativeSelect label="Take it from" value={storeId || usable.find(s => s.kind === "branch")?.id || usable[0]?.id || ""} onChange={e => setStoreId(e.target.value)}>{usable.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect>
        {item ? <div className="flex items-center justify-between rounded-md border border-border bg-tint/50 p-3"><span className="font-medium">{itemLabel(item)}</span><Button variant="ghost" size="sm" onClick={() => setItem(null)}>Change</Button></div> : <ItemPicker autoFocus onPick={i => (i.multiDose ? setItem(i) : toast.error(`${itemLabel(i)} is not set up as a multi-dose container.`))} placeholder="Search for the multi-dose item" />}
        {error && <p role="alert" className="rounded-md bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p>}
        <DialogActions><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!item || openVial.isPending} onClick={() => void go()}>{openVial.isPending && <Loader2 className="animate-spin" />}Open vial</Button></DialogActions>
      </div>
    </ResponsiveDialog>
  );
}

const TABS = [{ key: "open", label: "Open" }, { key: "empty", label: "Empty" }, { key: "discarded", label: "Discarded" }];

export default function VialsPage() {
  const { can } = useAuth();
  const confirm = useConfirm();
  const { discard } = useVialAction();
  const [status, setStatus] = useState("open");
  const [drawing, setDrawing] = useState<Vial | null>(null);
  const [opening, setOpening] = useState(false);
  const list = useVials(status);

  const doDiscard = async (v: Vial) => {
    if (!(await confirm({ title: "Discard this vial?", description: `${qty(v.remainingMl)} ml will be recorded as wasted.`, confirmLabel: "Discard", tone: "danger" }))) return;
    try { await discard.mutateAsync({ id: v.id, reason: v.pastBeyondUse ? "Past beyond-use date" : "Discarded by staff" }); toast.success("Vial discarded."); } catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <InventoryShell title="Open vials" description="Multi-dose vials in use, with how much is left and when each must be thrown away."
      actions={can("stock.issue") ? <Button onClick={() => setOpening(true)}><Plus /> Open a vial</Button> : undefined}>
      <div role="tablist" aria-label="Filter vials" className="mb-4 flex gap-2">
        {TABS.map(t => <button key={t.key} role="tab" aria-selected={status === t.key} onClick={() => setStatus(t.key)} className={cn("min-h-11 rounded-full border px-4 text-[15px]", status === t.key ? "border-primary bg-tint font-medium text-primary" : "border-border bg-card text-muted-foreground")}>{t.label}</button>)}
      </div>
      <QueryBoundary query={list} empty={{ when: r => r.length === 0, element: <EmptyState icon={<Droplet className="size-8" />} title="No vials here" description={status === "open" ? "Open a vial when you start using a multi-dose bottle." : undefined} /> }}>
        {rows => (
          <DataTable<Vial> caption="Vials" rows={rows} rowKey={v => v.id}
            columns={[
              { key: "item", header: "Item", primary: true, cell: v => <span>{v.itemName}<span className="num block text-sm font-normal text-muted-foreground">Batch {v.batchNo}</span></span> },
              { key: "left", header: "Left", align: "right", cell: v => <span className="num">{qty(v.remainingMl)} of {qty(v.volumeMl)} ml</span> },
              { key: "bud", header: "Use by", cell: v => <span className="inline-flex flex-wrap items-center gap-1">{dateIST(v.beyondUseAt)}{v.pastBeyondUse && v.status === "open" && <StatusBadge tone="danger">Past use-by</StatusBadge>}</span> },
              { key: "status", header: "Status", hideOnPhone: true, cell: v => <StatusText status={v.status} /> },
              { key: "act", header: "", align: "right", cell: v => v.status === "open" ? (
                <span className="inline-flex gap-1" data-touch-ok>
                  {can("dispense.write") && !v.pastBeyondUse && <Button size="sm" variant="secondary" onClick={() => setDrawing(v)}>Draw dose</Button>}
                  {can("stock.adjust") && <Button size="sm" variant="ghost" className="text-danger" onClick={() => void doDiscard(v)}>Discard</Button>}
                </span>) : null },
            ]} />
        )}
      </QueryBoundary>
      <DrawDialog vial={drawing} onClose={() => setDrawing(null)} />
      <OpenVialDialog open={opening} onClose={() => setOpening(false)} />
    </InventoryShell>
  );
}
