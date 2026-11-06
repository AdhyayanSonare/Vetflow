import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, Loader2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { toast } from "sonner";
import { api, errorMessage } from "@/api/client";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { DataTable } from "@/components/common/DataTable";
import { NativeSelect } from "@/components/common/Fields";
import { DialogActions, ResponsiveDialog } from "@/components/common/ResponsiveDialog";
import { EmptyState, QueryBoundary } from "@/components/common/States";
import { StatusText } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/features/auth/AuthProvider";
import { dateIST, dateTimeIST, qty } from "@/lib/format";
import { InventoryShell } from "../InventoryShell";
import { useInvalidateStock, useStores } from "../items/api";

type CountRow = { id: string; status: "open" | "posted"; storeName: string; createdAt: string };
type CountLine = { id: string; itemId: string; itemName: string; batchId: string; batchNo: string; expiryDate: string; systemQty: number; countedQty: number; variance: number; reason: string | null };
type Count = { id: string; status: "open" | "posted"; storeId: string; storeName: string; createdAt: string; postedAt: string | null; lines: CountLine[] };

const useCounts = () => useQuery({ queryKey: ["counts", "list"], queryFn: () => api.get<CountRow[]>("/api/counts") });
const useCount = (id: string) => useQuery({ queryKey: ["counts", "one", id], queryFn: () => api.get<Count>(`/api/counts/${id}`), enabled: !!id, refetchOnMount: "always" });

export function CountsPage() {
  const stores = useStores();
  const list = useCounts();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [storeId, setStoreId] = useState("");
  const usable = (stores.data ?? []).filter(s => s.kind !== "transit" && s.active);
  const start = useMutation({ mutationFn: (id: string) => api.post<Count>("/api/counts", { storeId: id }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["counts"] }); } });
  const go = async () => { try { const c = await start.mutateAsync(storeId || usable[0].id); setOpen(false); navigate(`/inventory/counts/${c.id}`); } catch (e) { toast.error(errorMessage(e)); } };

  return (
    <InventoryShell title="Stock counts" description="Count what is on the shelf and compare it with the system. Every difference needs a reason."
      actions={<Button onClick={() => setOpen(true)}><Plus /> Start a count</Button>}>
      <QueryBoundary query={list} empty={{ when: r => r.length === 0, element: <EmptyState title="No counts yet" description="Start a count for a store to check the shelf against the records." /> }}>
        {rows => (
          <DataTable<CountRow> caption="Stock counts" rows={rows} rowKey={c => c.id} href={c => `/inventory/counts/${c.id}`}
            columns={[
              { key: "store", header: "Store", primary: true, cell: c => c.storeName },
              { key: "status", header: "Status", cell: c => <StatusText status={c.status} /> },
              { key: "date", header: "Started", cell: c => dateTimeIST(c.createdAt) },
            ]} />
        )}
      </QueryBoundary>
      <ResponsiveDialog open={open} onOpenChange={setOpen} title="Start a count" description="Takes a snapshot of what the system says is in the store.">
        <NativeSelect label="Store" value={storeId || usable[0]?.id || ""} onChange={e => setStoreId(e.target.value)}>{usable.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect>
        <DialogActions><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={start.isPending} onClick={() => void go()}>{start.isPending && <Loader2 className="animate-spin" />}Start count</Button></DialogActions>
      </ResponsiveDialog>
    </InventoryShell>
  );
}

function CountSheet({ c }: { c: Count }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const invalidate = useInvalidateStock();
  const [edits, setEdits] = useState<Record<string, { counted: string; reason: string }>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { setEdits(Object.fromEntries(c.lines.map(l => [l.id, { counted: String(l.countedQty), reason: l.reason ?? "" }]))); }, [c]);
  const open = c.status === "open";
  const varianceOf = (l: CountLine) => Number(edits[l.id]?.counted ?? l.countedQty) - l.systemQty;
  const missingReason = c.lines.filter(l => Math.abs(varianceOf(l)) > 0.0005 && (edits[l.id]?.reason ?? "").trim().length < 3);

  const save = async (quiet = false) => {
    await api.put(`/api/counts/${c.id}/lines`, { lines: c.lines.map(l => ({ lineId: l.id, countedQty: Number(edits[l.id]?.counted ?? l.countedQty), reason: edits[l.id]?.reason?.trim() || null })) });
    void qc.invalidateQueries({ queryKey: ["counts"] });
    if (!quiet) toast.success("Count saved.");
  };
  const post = async () => {
    if (missingReason.length) { toast.error(`${missingReason.length} difference${missingReason.length === 1 ? " needs" : "s need"} a reason before posting.`); return; }
    const changes = c.lines.filter(l => Math.abs(varianceOf(l)) > 0.0005).length;
    if (!(await confirm({ title: "Post this count?", description: `${changes} ${changes === 1 ? "difference" : "differences"} will be written to stock as adjustments. This cannot be undone.`, confirmLabel: "Post count" }))) return;
    setBusy(true);
    try { await save(true); await api.post(`/api/counts/${c.id}/post`); invalidate(); void qc.invalidateQueries({ queryKey: ["counts"] }); toast.success("Count posted."); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <InventoryShell
      back={<Link href="/inventory/counts" className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" /> Counts</Link>}
      title={<span className="flex flex-wrap items-center gap-3">Count of {c.storeName} <StatusText status={c.status} /></span>}
      description={c.postedAt ? `Posted ${dateTimeIST(c.postedAt)}` : `Started ${dateTimeIST(c.createdAt)}. Enter what you counted.`}
      actions={open && <>
        <Button variant="secondary" onClick={() => void save().catch(e => toast.error(errorMessage(e)))}>Save progress</Button>
        {can("stock.adjust") ? <Button disabled={busy} onClick={() => void post()}>{busy ? <Loader2 className="animate-spin" /> : <Check />} Post count</Button> : <span className="self-center text-sm text-muted-foreground">A manager posts the count.</span>}
      </>}>
      {c.lines.length === 0 ? <EmptyState title="This store has no stock to count" /> : (
        <ul className="space-y-3">
          {c.lines.map(l => {
            const e = edits[l.id] ?? { counted: String(l.countedQty), reason: l.reason ?? "" };
            const v = varianceOf(l);
            const diff = Math.abs(v) > 0.0005;
            return (
              <li key={l.id} className={`rounded-xl border bg-card p-4 ${diff ? "border-warn/50" : "border-border"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-medium">{l.itemName}</p><p className="text-sm text-muted-foreground">Batch <span className="num">{l.batchNo}</span> · expires {dateIST(l.expiryDate)}</p></div><p className="num text-sm text-muted-foreground">System {qty(l.systemQty)}</p></div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[8rem_1fr] sm:items-end">
                  <div><label className="mb-1 block text-sm font-medium" htmlFor={`c-${l.id}`}>Counted</label><Input id={`c-${l.id}`} inputMode="decimal" className="num" disabled={!open} value={e.counted} onChange={ev => setEdits(s => ({ ...s, [l.id]: { ...e, counted: ev.target.value } }))} /></div>
                  {diff ? (
                    <div><label className="mb-1 block text-sm font-medium" htmlFor={`r-${l.id}`}>Why is it {v > 0 ? "more" : "less"} by <span className="num">{qty(Math.abs(v))}</span>?</label><Input id={`r-${l.id}`} disabled={!open} value={e.reason} onChange={ev => setEdits(s => ({ ...s, [l.id]: { ...e, reason: ev.target.value } }))} placeholder="Required" /></div>
                  ) : <p className="text-sm text-ok">Matches the system.</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </InventoryShell>
  );
}

export function CountPage() {
  const [, params] = useRoute<{ id: string }>("/inventory/counts/:id");
  const q = useCount(params?.id ?? "");
  return <QueryBoundary query={q}>{c => <CountSheet c={c} />}</QueryBoundary>;
}

export default CountsPage;
