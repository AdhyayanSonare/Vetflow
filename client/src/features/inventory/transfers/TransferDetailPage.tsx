import { ArrowRight, ChevronLeft, Loader2, PackageCheck, Truck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { toast } from "sonner";
import { errorMessage } from "@/api/client";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { TextField } from "@/components/common/Fields";
import { DialogActions, ResponsiveDialog } from "@/components/common/ResponsiveDialog";
import { QueryBoundary } from "@/components/common/States";
import { StatusBadge, StatusText } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/AuthProvider";
import { dateTimeIST, qty } from "@/lib/format";
import { InventoryShell } from "../InventoryShell";
import { useDispatchTransfer, useReceiveTransfer, useTransfer, type Transfer } from "./api";

function ReceiveDialog({ t, open, onClose }: { t: Transfer; open: boolean; onClose: () => void }) {
  const receive = useReceiveTransfer(t.id);
  const [got, setGot] = useState<Record<string, { qty: string; reason: string }>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setGot(Object.fromEntries(t.lines.map(l => [l.id, { qty: String(l.sentQty), reason: "" }]))); setError(null); } }, [open, t]);
  const short = (id: string, sent: number) => Number(got[id]?.qty ?? sent) < sent;
  const valid = t.lines.every(l => { const g = got[l.id]; if (!g) return false; const n = Number(g.qty); return g.qty !== "" && n >= 0 && n <= l.sentQty && (n >= l.sentQty || g.reason.trim().length >= 3); });

  const submit = async () => {
    setError(null);
    try { await receive.mutateAsync(t.lines.map(l => ({ lineId: l.id, receivedQty: Number(got[l.id].qty), reason: got[l.id].reason.trim() || undefined }))); toast.success("Transfer received."); onClose(); }
    catch (e) { setError(errorMessage(e)); }
  };
  return (
    <ResponsiveDialog open={open} onOpenChange={o => { if (!o) onClose(); }} title="Receive the goods" description="Count what actually arrived. If it is less than was sent, say why.">
      <div className="space-y-3">
        {t.lines.map(l => (
          <div key={l.id} className="rounded-lg border border-border p-3">
            <p className="font-medium">{l.itemName} <span className="text-sm font-normal text-muted-foreground">· batch <span className="num">{l.batchNo}</span> · sent {qty(l.sentQty)}</span></p>
            <div className="mt-2 grid gap-2 sm:grid-cols-[8rem_1fr]">
              <TextField label="Received" inputMode="decimal" className="num" value={got[l.id]?.qty ?? ""} onChange={e => setGot(g => ({ ...g, [l.id]: { ...g[l.id], qty: e.target.value } }))} error={Number(got[l.id]?.qty) > l.sentQty ? "More than was sent." : undefined} />
              {short(l.id, l.sentQty) && <TextField label="Why less?" value={got[l.id]?.reason ?? ""} onChange={e => setGot(g => ({ ...g, [l.id]: { ...g[l.id], reason: e.target.value } }))} hint="Saved with an alert so someone follows up." />}
            </div>
          </div>
        ))}
        {error && <p role="alert" className="rounded-md bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p>}
        <DialogActions><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!valid || receive.isPending} onClick={() => void submit()}>{receive.isPending && <Loader2 className="animate-spin" />}Confirm received</Button></DialogActions>
      </div>
    </ResponsiveDialog>
  );
}

function Detail({ t }: { t: Transfer }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const dispatch = useDispatchTransfer();
  const [receiving, setReceiving] = useState(false);
  const doDispatch = async () => {
    if (!(await confirm({ title: "Dispatch this transfer?", description: `The stock leaves ${t.fromStore} now and is held in transit until ${t.toStore} confirms it.`, confirmLabel: "Dispatch" }))) return;
    try { await dispatch.mutateAsync(t.id); toast.success("Dispatched. The stock is in transit."); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <InventoryShell
      back={<Link href="/inventory/transfers" className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" /> Transfers</Link>}
      title={<span className="flex flex-wrap items-center gap-3">{t.fromStore} <ArrowRight className="size-5 text-muted-foreground" /> {t.toStore} <StatusText status={t.status} /></span>}
      description={[`Created ${dateTimeIST(t.createdAt)}`, t.dispatchedAt && `Dispatched ${dateTimeIST(t.dispatchedAt)}`, t.receivedAt && `Received ${dateTimeIST(t.receivedAt)}`].filter(Boolean).join(" · ")}
      actions={can("transfer.write") && <>
        {t.status === "draft" && <Button onClick={() => void doDispatch()} disabled={dispatch.isPending}><Truck /> Dispatch</Button>}
        {t.status === "dispatched" && <Button onClick={() => setReceiving(true)}><PackageCheck /> Receive</Button>}
      </>}>
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {t.lines.map(l => (
          <li key={l.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div><p className="font-medium">{l.itemName}</p><p className="text-sm text-muted-foreground">Batch <span className="num">{l.batchNo}</span></p></div>
            <div className="num text-right text-sm"><p>Sent {qty(l.sentQty)}</p>{l.receivedQty != null && <p className={l.receivedQty < l.sentQty ? "text-danger" : "text-ok"}>Received {qty(l.receivedQty)}</p>}{l.discrepancyReason && <StatusBadge tone="danger" className="mt-1">{l.discrepancyReason}</StatusBadge>}</div>
          </li>
        ))}
      </ul>
      <ReceiveDialog t={t} open={receiving} onClose={() => setReceiving(false)} />
    </InventoryShell>
  );
}

export default function TransferDetailPage() {
  const [, params] = useRoute<{ id: string }>("/inventory/transfers/:id");
  const q = useTransfer(params?.id ?? "");
  return <QueryBoundary query={q}>{t => <Detail t={t} />}</QueryBoundary>;
}
