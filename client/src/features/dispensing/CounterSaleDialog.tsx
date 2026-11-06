import { Loader2, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/api/client";
import { NativeSelect, TextField } from "@/components/common/Fields";
import { DialogActions, ResponsiveDialog } from "@/components/common/ResponsiveDialog";
import { Button } from "@/components/ui/button";
import { ItemPicker } from "@/features/inventory/items/ItemPicker";
import { itemLabel, useStores, type Item } from "@/features/inventory/items/api";
import { useDispense } from "./api";
import { DispenseLineRow, linesReady, needsWitness, WitnessFields, type DispenseLine } from "./components";

const REASONS = ["Walk-in purchase", "Staff use", "Emergency treatment", "Sample or demonstration", "Other"];

/** A sale or issue with no prescription. It needs a reason, an authorised role, and is audited like any other dispense. */
export function CounterSaleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const stores = useStores();
  const dispense = useDispense();
  const usable = useMemo(() => (stores.data ?? []).filter(s => s.kind !== "transit" && s.active), [stores.data]);
  const [storeId, setStoreId] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  const [other, setOther] = useState("");
  const [lines, setLines] = useState<DispenseLine[]>([]);
  const [adding, setAdding] = useState(false);
  const [witness, setWitness] = useState({ witnessId: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!storeId && usable.length) setStoreId((usable.find(s => s.kind === "branch") ?? usable[0]).id); }, [usable, storeId]);

  const reset = () => { setLines([]); setReason(REASONS[0]); setOther(""); setWitness({ witnessId: "", password: "" }); setError(null); setAdding(false); };
  const close = () => { reset(); onClose(); };
  const finalReason = reason === "Other" ? other.trim() : reason;
  const ready = !!storeId && finalReason.length >= 3 && linesReady(lines) && (!needsWitness(lines) || (!!witness.witnessId && !!witness.password));

  const add = (item: Item) => {
    setAdding(false);
    if (lines.some(l => l.itemId === item.id)) return;
    setLines(ls => [...ls, { key: item.id, itemId: item.id, name: itemLabel(item), unit: item.unit, quantity: "1", controlled: item.controlled, max: null }]);
  };

  const submit = async () => {
    setError(null);
    try {
      await dispense.mutateAsync({
        storeId, counterReason: finalReason, lines: lines.map(l => ({ itemId: l.itemId, quantity: Number(l.quantity) })),
        witness: needsWitness(lines) ? { witnessUserId: witness.witnessId, witnessPassword: witness.password } : undefined,
      });
      toast.success("Counter sale recorded. Stock has been updated.");
      close();
    } catch (e) { setError(errorMessage(e)); }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={o => { if (!o) close(); }} size="lg" title="Counter sale" description="For a sale or issue with no prescription.">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <NativeSelect label="Take stock from" value={storeId} onChange={e => setStoreId(e.target.value)}>{usable.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect>
          <NativeSelect label="Reason" value={reason} onChange={e => setReason(e.target.value)}>{REASONS.map(r => <option key={r}>{r}</option>)}</NativeSelect>
        </div>
        {reason === "Other" && <TextField label="Say why" value={other} onChange={e => setOther(e.target.value)} hint="At least 3 characters. It is saved in the audit log." />}

        {lines.length > 0 && (
          <ul className="space-y-3">{lines.map(l => (
            <div key={l.key} className="relative">
              <DispenseLineRow line={l} storeId={storeId} onChange={n => setLines(ls => ls.map(x => (x.key === n.key ? n : x)))} />
              <button type="button" aria-label={`Remove ${l.name}`} onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))} className="absolute -right-2 -top-2 flex size-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-danger"><X className="size-4" /></button>
            </div>
          ))}</ul>
        )}
        {adding ? <ItemPicker onPick={add} autoFocus /> : <Button type="button" variant="secondary" onClick={() => setAdding(true)}><Plus /> Add an item</Button>}

        {needsWitness(lines) && <WitnessFields witnessId={witness.witnessId} password={witness.password} onChange={setWitness} />}
        {error && <p role="alert" className="rounded-md bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p>}
        <DialogActions>
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button disabled={!ready || dispense.isPending} onClick={() => void submit()}>{dispense.isPending && <Loader2 className="animate-spin" />}Confirm sale</Button>
        </DialogActions>
      </div>
    </ResponsiveDialog>
  );
}
