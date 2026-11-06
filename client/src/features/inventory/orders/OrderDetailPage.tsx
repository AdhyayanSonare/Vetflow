import { Check, ChevronLeft, Loader2, PackagePlus, Send, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { toast } from "sonner";
import { errorMessage } from "@/api/client";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { TextField } from "@/components/common/Fields";
import { DialogActions, ResponsiveDialog } from "@/components/common/ResponsiveDialog";
import { QueryBoundary } from "@/components/common/States";
import { StatusText } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/AuthProvider";
import { dateIST, money, qty } from "@/lib/format";
import { InventoryShell } from "../InventoryShell";
import { useOrder, useOrderAction, useReceiveOrder, type Order } from "./api";

type Row = { lineId: string; name: string; unit: string; outstanding: number; quantity: string; batchNo: string; expiryDate: string };

/** Record a delivery against the order. A part delivery is fine: the rest stays open. It makes a draft receipt to confirm. */
function ReceiveDialog({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  const [, navigate] = useLocation();
  const receive = useReceiveOrder(order.id);
  const [rows, setRows] = useState<Row[]>([]);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setRows(order.lines.filter(l => l.outstandingQty > 0).map(l => ({ lineId: l.id, name: l.itemName, unit: l.unit, outstanding: l.outstandingQty, quantity: "", batchNo: "", expiryDate: "" }))); setInvoiceNo(""); setError(null); }
  }, [open, order]);
  const used = rows.filter(r => r.quantity.trim() !== "" && Number(r.quantity) > 0);
  const valid = used.length > 0 && used.every(r => r.batchNo.trim() && /^\d{4}-\d{2}-\d{2}$/.test(r.expiryDate) && Number(r.quantity) <= r.outstanding + 1e-9);
  const set = (id: string, p: Partial<Row>) => setRows(rs => rs.map(r => (r.lineId === id ? { ...r, ...p } : r)));

  const submit = async () => {
    setError(null);
    try {
      const r = await receive.mutateAsync({ invoiceNo: invoiceNo.trim() || undefined, lines: used.map(x => ({ poLineId: x.lineId, quantity: Number(x.quantity), batchNo: x.batchNo.trim(), expiryDate: x.expiryDate })) });
      toast.success("Draft receipt made. Confirm it to add the stock.");
      onClose(); navigate(`/inventory/receipts/${r.receiptId}`);
    } catch (e) { setError(errorMessage(e)); }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={o => { if (!o) onClose(); }} size="lg" title="Receive a delivery" description="Fill in only the lines that arrived. Leave the rest blank.">
      <div className="space-y-4">
        <TextField label="Invoice number" value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} />
        <ul className="space-y-3">{rows.map(r => (
          <li key={r.lineId} className="rounded-lg border border-border p-3">
            <p className="mb-2 font-medium">{r.name} <span className="text-sm font-normal text-muted-foreground">· {qty(r.outstanding, r.unit)} still open</span></p>
            <div className="grid grid-cols-3 gap-2">
              <TextField label="Received" inputMode="decimal" className="num" value={r.quantity} onChange={e => set(r.lineId, { quantity: e.target.value })} error={Number(r.quantity) > r.outstanding ? "More than is open." : undefined} />
              <TextField label="Batch" className="num" value={r.batchNo} onChange={e => set(r.lineId, { batchNo: e.target.value })} />
              <TextField label="Expiry" type="date" value={r.expiryDate} onChange={e => set(r.lineId, { expiryDate: e.target.value })} />
            </div>
          </li>))}</ul>
        {error && <p role="alert" className="rounded-md bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p>}
        <DialogActions><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!valid || receive.isPending} onClick={() => void submit()}>{receive.isPending && <Loader2 className="animate-spin" />}Make draft receipt</Button></DialogActions>
      </div>
    </ResponsiveDialog>
  );
}

function Detail({ o }: { o: Order }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const send = useOrderAction("send");
  const cancel = useOrderAction("cancel");
  const [receiving, setReceiving] = useState(false);
  const total = o.lines.reduce((n, l) => n + l.orderedQty * l.unitCostPaise, 0);

  const doSend = async () => { if (await confirm({ title: "Send this order?", description: `Marks ${o.number} as sent to ${o.supplierName}. You can then record deliveries against it.`, confirmLabel: "Mark as sent" })) try { await send.mutateAsync(o.id); toast.success("Order sent."); } catch (e) { toast.error(errorMessage(e)); } };
  const doCancel = async () => { if (await confirm({ title: "Cancel this order?", description: "It stays in the list as cancelled.", confirmLabel: "Cancel order", tone: "danger" })) try { await cancel.mutateAsync(o.id); toast.success("Order cancelled."); } catch (e) { toast.error(errorMessage(e)); } };

  return (
    <InventoryShell
      back={<Link href="/inventory/orders" className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" /> Orders</Link>}
      title={<span className="flex flex-wrap items-center gap-3"><span className="num">{o.number}</span> <StatusText status={o.status} /></span>}
      description={`${o.supplierName} · deliver to ${o.storeName}${o.expectedDate ? ` · expected ${dateIST(o.expectedDate)}` : ""}`}
      actions={<>
        {o.status === "draft" && can("purchase.confirm") && <Button onClick={() => void doSend()}><Send /> Send</Button>}
        {(o.status === "sent" || o.status === "partially_received") && can("purchase.write") && <Button onClick={() => setReceiving(true)}><PackagePlus /> Receive delivery</Button>}
        {(o.status === "draft" || o.status === "sent") && can("purchase.confirm") && <Button variant="ghost" className="text-danger" onClick={() => void doCancel()}><X /> Cancel order</Button>}
      </>}>
      {o.notes && <p className="mb-4 rounded-lg bg-tint px-3 py-2">{o.notes}</p>}
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {o.lines.map(l => (
          <li key={l.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div className="min-w-0"><p className="font-medium">{l.itemName}</p><p className="num text-sm text-muted-foreground">{l.code}</p></div>
            <div className="num text-right text-sm"><p>{qty(l.receivedQty)} of {qty(l.orderedQty, l.unit)} received</p>{l.outstandingQty > 0 ? <p className="text-warn">{qty(l.outstandingQty)} open</p> : <p className="inline-flex items-center gap-1 text-ok"><Check className="size-3.5" /> Complete</p>}{l.unitCostPaise > 0 && <p className="text-muted-foreground">{money(l.unitCostPaise)} each</p>}</div>
          </li>
        ))}
      </ul>
      {total > 0 && <p className="mt-4 text-right text-lg">Order value <span className="num font-medium">{money(total)}</span></p>}
      <ReceiveDialog order={o} open={receiving} onClose={() => setReceiving(false)} />
    </InventoryShell>
  );
}

export default function OrderDetailPage() {
  const [, params] = useRoute<{ id: string }>("/inventory/orders/:id");
  const q = useOrder(params?.id ?? "");
  return <QueryBoundary query={q}>{o => <Detail o={o} />}</QueryBoundary>;
}
