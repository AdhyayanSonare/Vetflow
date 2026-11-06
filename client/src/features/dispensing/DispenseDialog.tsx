import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/api/client";
import { NativeSelect } from "@/components/common/Fields";
import { DialogActions, ResponsiveDialog } from "@/components/common/ResponsiveDialog";
import { LoadingState } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { useStores } from "@/features/inventory/items/api";
import { usePrescription } from "@/features/prescriptions/api";
import { useDispense } from "./api";
import { DispenseLineRow, linesReady, needsWitness, WitnessFields, type DispenseLine } from "./components";

/** Dispense an approved prescription. Only what is still owing is offered, and the batches are shown before anything is taken. */
export function DispenseDialog({ prescriptionId, onClose }: { prescriptionId: string | null; onClose: () => void }) {
  const rx = usePrescription(prescriptionId ?? undefined);
  const stores = useStores();
  const dispense = useDispense();
  const [storeId, setStoreId] = useState("");
  const [lines, setLines] = useState<DispenseLine[]>([]);
  const [witness, setWitness] = useState({ witnessId: "", password: "" });
  const [error, setError] = useState<string | null>(null);

  const usable = useMemo(() => (stores.data ?? []).filter(s => s.kind !== "transit" && s.active), [stores.data]);
  useEffect(() => { if (!storeId && usable.length) setStoreId((usable.find(s => s.kind === "branch") ?? usable[0]).id); }, [usable, storeId]);
  useEffect(() => {
    if (!rx.data) return;
    setLines(rx.data.lines.filter(l => l.itemId && (l.quantity == null || l.quantity > l.dispensed)).map(l => {
      const left = l.quantity != null ? Math.round((l.quantity - l.dispensed) * 1000) / 1000 : null;
      return { key: l.id, itemId: l.itemId!, name: l.drugText, unit: l.unit ?? "", quantity: left != null ? String(left) : "", controlled: !!l.controlled, max: left };
    }));
    setWitness({ witnessId: "", password: "" });
    setError(null);
  }, [rx.data]);

  const witnessOk = !needsWitness(lines) || (!!witness.witnessId && witness.password.length > 0);
  const ready = !!storeId && linesReady(lines) && witnessOk;

  const submit = async () => {
    setError(null);
    try {
      await dispense.mutateAsync({
        storeId, prescriptionId: prescriptionId!, lines: lines.map(l => ({ itemId: l.itemId, quantity: Number(l.quantity) })),
        witness: needsWitness(lines) ? { witnessUserId: witness.witnessId, witnessPassword: witness.password } : undefined,
      });
      toast.success("Dispensed. Stock has been updated.");
      onClose();
    } catch (e) { setError(errorMessage(e)); }
  };

  return (
    <ResponsiveDialog open={!!prescriptionId} onOpenChange={o => { if (!o) onClose(); }} size="lg"
      title={rx.data ? `Dispense for ${rx.data.animalName}` : "Dispense"} description={rx.data ? `${rx.data.ownerName} · prescribed by ${rx.data.vetName}` : undefined}>
      {rx.isPending || stores.isPending ? <LoadingState rows={3} /> : (
        <div className="space-y-4">
          <NativeSelect label="Take stock from" value={storeId} onChange={e => setStoreId(e.target.value)}>
            {usable.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </NativeSelect>
          {lines.length === 0 ? <p className="text-muted-foreground">Everything on this prescription has already been dispensed.</p> : (
            <ul className="space-y-3">{lines.map(l => <DispenseLineRow key={l.key} line={l} storeId={storeId} onChange={n => setLines(ls => ls.map(x => (x.key === n.key ? n : x)))} />)}</ul>
          )}
          {needsWitness(lines) && <WitnessFields witnessId={witness.witnessId} password={witness.password} onChange={v => setWitness(v)} />}
          {error && <p role="alert" className="rounded-md bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p>}
          <DialogActions>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button disabled={!ready || dispense.isPending} onClick={() => void submit()}>{dispense.isPending && <Loader2 className="animate-spin" />}Confirm dispense</Button>
          </DialogActions>
        </div>
      )}
    </ResponsiveDialog>
  );
}
