import { Check, ChevronLeft, FileUp, Loader2, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { toast } from "sonner";
import { errorMessage } from "@/api/client";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { NativeSelect, TextField } from "@/components/common/Fields";
import { DialogActions, ResponsiveDialog } from "@/components/common/ResponsiveDialog";
import { QueryBoundary } from "@/components/common/States";
import { StatusBadge, StatusText } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/AuthProvider";
import { dateIST, expiryStatus, money, qty, todayIST } from "@/lib/format";
import { parseRupees } from "@/lib/money";
import { InventoryShell } from "../InventoryShell";
import { itemLabel, useStores, type Item } from "../items/api";
import { ItemPicker } from "../items/ItemPicker";
import { useSuppliers } from "../suppliers/api";
import { uploadAttachment, useCancelReceipt, useConfirmReceipt, useReceipt, useSaveReceipt, type Receipt } from "./api";

type Row = { key: string; item: Item; batchNo: string; expiryDate: string; mfgDate: string; quantity: string; cost: string };
const newRow = (item: Item): Row => ({ key: `${item.id}-${Math.random().toString(36).slice(2, 7)}`, item, batchNo: "", expiryDate: "", mfgDate: "", quantity: "", cost: "" });

function rowProblem(r: Row): string | null {
  if (!r.batchNo.trim()) return "Enter the batch number from the pack.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.expiryDate)) return "Enter the expiry date.";
  if (!(Number(r.quantity) > 0)) return "Enter the quantity received.";
  if (parseRupees(r.cost) === null) return "Enter the cost per unit in rupees. Use 0 if it is free.";
  return null;
}

/** A new receipt: who delivered, where it goes, and every batch with its expiry. Saved as a draft first. */
function NewReceipt() {
  const [, navigate] = useLocation();
  const suppliers = useSuppliers();
  const stores = useStores();
  const save = useSaveReceipt();
  const usable = useMemo(() => (stores.data ?? []).filter(s => s.kind !== "transit" && s.active), [stores.data]);
  const [supplierId, setSupplierId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [picking, setPicking] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = rows.reduce((n, r) => n + (Number(r.quantity) > 0 ? Number(r.quantity) * (parseRupees(r.cost) ?? 0) : 0), 0);
  const set = (key: string, patch: Partial<Row>) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));
  const invalid = !supplierId || !(storeId || usable[0]) || rows.length === 0 || rows.some(r => rowProblem(r));

  const submit = async () => {
    setTried(true); setError(null);
    if (invalid) return;
    try {
      const attachmentId = file ? (await uploadAttachment(file)).id : undefined;
      const r = await save.mutateAsync({
        supplierId, storeId: storeId || usable[0].id, invoiceNo: invoiceNo.trim() || undefined, invoiceDate: invoiceDate || undefined, attachmentId,
        lines: rows.map(x => ({ itemId: x.item.id, batchNo: x.batchNo.trim(), expiryDate: x.expiryDate, mfgDate: x.mfgDate || undefined, quantity: Number(x.quantity), unitCostPaise: parseRupees(x.cost)! })),
      });
      toast.success("Draft saved. Confirm it to put the stock on the shelf.");
      navigate(`/inventory/receipts/${r.id}`, { replace: true });
    } catch (e) { setError(errorMessage(e)); }
  };

  return (
    <InventoryShell title="New receipt" description="Enter what arrived. Nothing changes in stock until you confirm."
      back={<Link href="/inventory/receipts" className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" /> Receipts</Link>}>
      <div className="grid gap-4 md:grid-cols-2">
        <NativeSelect label="Supplier" required value={supplierId} onChange={e => setSupplierId(e.target.value)} error={tried && !supplierId ? "Choose the supplier." : undefined}>
          <option value="">Choose a supplier</option>{suppliers.data?.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </NativeSelect>
        <NativeSelect label="Received into" required value={storeId || usable[0]?.id || ""} onChange={e => setStoreId(e.target.value)}>{usable.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect>
        <TextField label="Invoice number" value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} />
        <TextField label="Invoice date" type="date" max={todayIST()} value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
        <div className="md:col-span-2">
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-4 hover:bg-tint">
            <FileUp className="size-[18px]" />{file ? file.name : "Attach the invoice (PDF or photo)"}
            <input type="file" hidden accept="application/pdf,image/png,image/jpeg,image/webp" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </label>
        </div>
      </div>

      <h2 className="mb-3 mt-8">Items received</h2>
      {rows.length === 0 && <p className="mb-3 rounded-xl border border-dashed border-border p-6 text-center text-muted-foreground">Add each medicine or supply that arrived.</p>}
      <ul className="space-y-3">
        {rows.map(r => {
          const problem = tried ? rowProblem(r) : null;
          const exp = /^\d{4}-\d{2}-\d{2}$/.test(r.expiryDate) ? expiryStatus(r.expiryDate) : null;
          return (
            <li key={r.key} className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-start justify-between gap-3"><p className="font-medium">{itemLabel(r.item)} <span className="num text-sm font-normal text-muted-foreground">{r.item.code}</span></p>
                <Button variant="ghost" size="icon-sm" aria-label={`Remove ${itemLabel(r.item)}`} onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))}><Trash2 /></Button></div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <TextField label="Batch number" className="num" value={r.batchNo} onChange={e => set(r.key, { batchNo: e.target.value })} />
                <TextField label="Expiry date" type="date" value={r.expiryDate} onChange={e => set(r.key, { expiryDate: e.target.value })} hint={exp && exp.tone !== "neutral" ? exp.label : undefined} />
                <TextField label={`Quantity (${r.item.unit})`} inputMode="decimal" className="num" value={r.quantity} onChange={e => set(r.key, { quantity: e.target.value })} />
                <TextField label="Cost per unit (₹)" inputMode="decimal" className="num" value={r.cost} onChange={e => set(r.key, { cost: e.target.value })} />
                <TextField label="Made on (optional)" type="date" value={r.mfgDate} onChange={e => set(r.key, { mfgDate: e.target.value })} />
              </div>
              {problem && <p role="alert" className="mt-2 text-sm text-danger">{problem}</p>}
              {exp?.tone === "danger" && exp.days < 0 && <StatusBadge tone="danger" className="mt-2">This batch is already expired and cannot be issued</StatusBadge>}
            </li>
          );
        })}
      </ul>
      <Button variant="secondary" className="mt-3" onClick={() => setPicking(true)}><Plus /> Add an item</Button>

      <div className="mt-6 flex flex-col gap-3 border-t border-border pt-4 md:flex-row md:items-center md:justify-between">
        <p className="text-lg">Total <span className="num font-medium">{money(total)}</span></p>
        <div className="flex gap-2 [&>*]:flex-1 md:[&>*]:flex-none">
          <Button variant="secondary" asChild><Link href="/inventory/receipts">Cancel</Link></Button>
          <Button onClick={() => void submit()} disabled={save.isPending}>{save.isPending && <Loader2 className="animate-spin" />}Save draft</Button>
        </div>
      </div>
      {tried && invalid && rows.length === 0 && <p role="alert" className="mt-2 text-sm text-danger">Add at least one item.</p>}
      {error && <p role="alert" className="mt-2 rounded-md bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p>}

      <ResponsiveDialog open={picking} onOpenChange={setPicking} title="Add an item" description="Search the catalogue. A barcode scanner works here too.">
        <ItemPicker autoFocus showStock={false} onPick={item => { setRows(rs => [...rs, newRow(item)]); setPicking(false); }} />
        <DialogActions><Button variant="secondary" onClick={() => setPicking(false)}>Close</Button></DialogActions>
      </ResponsiveDialog>
    </InventoryShell>
  );
}

function ViewReceipt({ r }: { r: Receipt }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const confirmReceipt = useConfirmReceipt();
  const cancel = useCancelReceipt();
  const [, navigate] = useLocation();
  const total = r.lines.reduce((n, l) => n + l.quantity * l.unitCostPaise, 0);

  const doConfirm = async () => {
    const units = r.lines.reduce((n, l) => n + l.quantity, 0);
    if (!(await confirm({ title: "Confirm this receipt?", description: <p>This puts {qty(units)} units across {r.lines.length} {r.lines.length === 1 ? "line" : "lines"} into stock. It cannot be undone. A mistake is fixed with a stock adjustment.</p>, confirmLabel: "Confirm receipt" }))) return;
    try { await confirmReceipt.mutateAsync(r.id); toast.success("Receipt confirmed. Stock has been updated."); } catch (e) { toast.error(errorMessage(e)); }
  };
  const doCancel = async () => {
    if (!(await confirm({ title: "Discard this draft?", description: "Nothing has been added to stock, so nothing else changes.", confirmLabel: "Discard", tone: "danger" }))) return;
    try { await cancel.mutateAsync(r.id); toast.success("Draft discarded."); navigate("/inventory/receipts"); } catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <InventoryShell
      back={<Link href="/inventory/receipts" className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" /> Receipts</Link>}
      title={<span className="flex flex-wrap items-center gap-3">Receipt from {r.supplierName} <StatusText status={r.status} /></span>}
      description={[r.invoiceNo && `Invoice ${r.invoiceNo}`, r.invoiceDate && dateIST(r.invoiceDate), `Entered ${dateIST(r.createdAt)}`].filter(Boolean).join(" · ")}
      actions={r.status === "draft" && (
        <>
          {can("purchase.write") && <Button variant="ghost" className="text-danger" onClick={() => void doCancel()}>Discard draft</Button>}
          {can("purchase.confirm") && <Button onClick={() => void doConfirm()} disabled={confirmReceipt.isPending}><Check /> Confirm receipt</Button>}
        </>
      )}>
      {r.status === "draft" && <p className="mb-4 rounded-lg bg-warn-tint px-3 py-2 text-sm text-warn">Draft. Stock has not changed yet.{!can("purchase.confirm") && " Someone with permission to confirm purchases needs to confirm it."}</p>}
      {r.attachmentId && <p className="mb-4"><a className="text-primary underline-offset-4 hover:underline" href={`/api/attachments/${r.attachmentId}`} target="_blank" rel="noreferrer">View the attached invoice</a></p>}
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {r.lines.map(l => {
          const e = expiryStatus(l.expiryDate);
          return (
            <li key={l.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0"><p className="font-medium">{l.itemName}</p><p className="text-sm text-muted-foreground">Batch <span className="num">{l.batchNo}</span> · <StatusBadge tone={e.tone}>{e.label}</StatusBadge></p></div>
              <div className="num text-right"><p>{qty(l.quantity)} × {money(l.unitCostPaise)}</p><p className="text-sm text-muted-foreground">{money(l.quantity * l.unitCostPaise)}</p></div>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-right text-lg">Total <span className="num font-medium">{money(total)}</span></p>
    </InventoryShell>
  );
}

export default function ReceiptEditorPage() {
  const [isNew] = useRoute("/inventory/receipts/new");
  const [, params] = useRoute<{ id: string }>("/inventory/receipts/:id");
  const q = useReceipt(isNew ? "" : params?.id ?? "");
  if (isNew) return <NewReceipt />;
  return <QueryBoundary query={q}>{r => <ViewReceipt r={r} />}</QueryBoundary>;
}
