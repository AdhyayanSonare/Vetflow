import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/api/client";
import { NativeSelect, TextAreaField, TextField } from "@/components/common/Fields";
import { DialogActions, ResponsiveDialog } from "@/components/common/ResponsiveDialog";
import { Button } from "@/components/ui/button";
import { dateIST, qty as fmtQty } from "@/lib/format";
import { useInvalidateStock, type Item, type StockRow } from "./api";

const KINDS = [
  { key: "damage", label: "Damaged or spilled", body: { type: "damage" } },
  { key: "expiry_writeoff", label: "Expired: write off", body: { type: "expiry_writeoff" } },
  { key: "return_to_supplier", label: "Return to supplier", body: { type: "return_to_supplier" } },
  { key: "increase", label: "Count correction: add stock", body: { type: "count_adjustment", direction: "increase" } },
  { key: "decrease", label: "Count correction: remove stock", body: { type: "count_adjustment", direction: "decrease" } },
] as const;

/** Take stock out, or correct it, with a reason that is saved in the audit log. Never a silent edit. */
export function AdjustStockDialog({ item, rows, open, onClose, presetBatchId }: { item: Item; rows: StockRow[]; open: boolean; onClose: () => void; presetBatchId?: string }) {
  const invalidate = useInvalidateStock();
  const [rowKey, setRowKey] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]["key"]>("damage");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyOf = (r: StockRow) => `${r.batchId}:${r.storeId}`;

  useEffect(() => {
    if (!open) return;
    const first = rows.find(r => r.batchId === presetBatchId) ?? rows[0];
    setRowKey(first ? keyOf(first) : "");
    setKind(first?.expired ? "expiry_writeoff" : "damage");
    setQuantity(""); setReason(""); setError(null);
  }, [open, rows, presetBatchId]);

  const row = rows.find(r => keyOf(r) === rowKey);
  const q = Number(quantity);
  const valid = !!row && q > 0 && reason.trim().length >= 3;

  const submit = async () => {
    if (!row) return;
    setBusy(true); setError(null);
    try {
      await api.post("/api/stock/adjust", { ...KINDS.find(k => k.key === kind)!.body, itemId: item.id, batchId: row.batchId, storeId: row.storeId, quantity: q, reason: reason.trim() },
        { headers: { "Idempotency-Key": crypto.randomUUID() } });
      invalidate();
      toast.success("Stock adjusted and recorded in the audit log.");
      onClose();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={o => { if (!o) onClose(); }} title="Adjust stock" description={`${item.genericName}${item.strength ? ` ${item.strength}` : ""}`}>
      {rows.length === 0 ? <p className="text-muted-foreground">There is no stock of this item to adjust.</p> : (
        <div className="space-y-4">
          <NativeSelect label="Batch and store" value={rowKey} onChange={e => setRowKey(e.target.value)}>
            {rows.map(r => <option key={keyOf(r)} value={keyOf(r)}>{r.storeName} · batch {r.batchNo} · {dateIST(r.expiryDate)} · {fmtQty(r.quantity, item.unit)}</option>)}
          </NativeSelect>
          <NativeSelect label="What happened?" value={kind} onChange={e => setKind(e.target.value as typeof kind)}>{KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}</NativeSelect>
          <TextField label={`Quantity (${item.unit})`} inputMode="decimal" className="num" value={quantity} onChange={e => setQuantity(e.target.value)}
            hint={row ? `${fmtQty(row.quantity, item.unit)} in this batch` : undefined} error={kind !== "increase" && row && q > row.quantity ? "More than the batch holds." : undefined} />
          <TextAreaField label="Reason" rows={2} value={reason} onChange={e => setReason(e.target.value)} hint="Required. At least 3 characters. Saved with your name and the time." />
          {error && <p role="alert" className="rounded-md bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p>}
          <DialogActions>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button disabled={!valid || busy} onClick={() => void submit()}>{busy && <Loader2 className="animate-spin" />}Record adjustment</Button>
          </DialogActions>
        </div>
      )}
    </ResponsiveDialog>
  );
}
