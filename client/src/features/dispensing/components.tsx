import { ShieldCheck } from "lucide-react";
import { errorMessage } from "@/api/client";
import { NativeSelect, TextField } from "@/components/common/Fields";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { expiryStatus, qty as fmtQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useSuggest, useWitnesses } from "./api";

export type DispenseLine = { key: string; itemId: string; name: string; unit: string; quantity: string; controlled: boolean; max: number | null };

/** What would be taken from stock for one line: the batches, in the order they will be used. */
export function BatchPreview({ itemId, storeId, quantity }: { itemId: string; storeId: string; quantity: number }) {
  const q = useSuggest({ itemId, storeId, quantity }, true);
  if (!(quantity > 0)) return null;
  if (q.isPending) return <p className="text-sm text-muted-foreground">Checking stock…</p>;
  if (q.isError) return <p role="alert" className="text-sm text-danger">{errorMessage(q.error)}</p>;
  return (
    <ul className="space-y-1 text-sm">
      {q.data.map(a => {
        const e = expiryStatus(a.expiryDate);
        return (
          <li key={a.batchId} className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
            <span className="num text-foreground">{fmtQty(Number(a.take))}</span> from batch <span className="num text-foreground">{a.batchNo}</span>
            <StatusBadge tone={e.tone}>{e.label}</StatusBadge>
          </li>
        );
      })}
    </ul>
  );
}

export function DispenseLineRow({ line, storeId, onChange }: { line: DispenseLine; storeId: string; onChange: (l: DispenseLine) => void }) {
  const n = Number(line.quantity);
  const over = line.max != null && n > line.max + 1e-9;
  return (
    <li className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="font-medium break-words">{line.name}</p>
          {line.max != null && <p className="text-sm text-muted-foreground">Up to {fmtQty(line.max, line.unit)} left on the prescription</p>}
          {line.controlled && <StatusBadge tone="warn" className="mt-1 gap-1"><ShieldCheck className="size-3.5" /> Controlled: second person needed</StatusBadge>}
        </div>
        <div className="w-28 shrink-0">
          <Label htmlFor={`q-${line.key}`} className="sr-only">Quantity of {line.name}</Label>
          <Input id={`q-${line.key}`} inputMode="decimal" className="num text-right" value={line.quantity} aria-invalid={over} onChange={e => onChange({ ...line, quantity: e.target.value })} />
          <p className="mt-0.5 text-right text-xs text-muted-foreground">{line.unit}</p>
        </div>
      </div>
      {over && <p role="alert" className="text-sm text-danger">More than the {fmtQty(line.max!)} left on the prescription.</p>}
      <BatchPreview itemId={line.itemId} storeId={storeId} quantity={over ? 0 : n} />
    </li>
  );
}

/** The second person who confirms a controlled medicine, with their own password. */
export function WitnessFields({ witnessId, password, onChange }: { witnessId: string; password: string; onChange: (v: { witnessId: string; password: string }) => void }) {
  const w = useWitnesses(true);
  return (
    <fieldset className="space-y-3 rounded-lg border border-warn/40 bg-warn-tint/40 p-3">
      <legend className="flex items-center gap-1.5 px-1 font-medium"><ShieldCheck className="size-4" /> Second person</legend>
      <p className="text-sm text-muted-foreground">A controlled medicine needs a second member of staff to confirm. They enter their own password. It is not stored.</p>
      <NativeSelect label="Who is confirming?" value={witnessId} onChange={e => onChange({ witnessId: e.target.value, password })}>
        <option value="">Choose a person</option>
        {w.data?.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
      </NativeSelect>
      <TextField label="Their password" type="password" autoComplete="off" value={password} onChange={e => onChange({ witnessId, password: e.target.value })} />
    </fieldset>
  );
}

export const needsWitness = (lines: DispenseLine[]) => lines.some(l => l.controlled);
export const linesReady = (lines: DispenseLine[]) => lines.length > 0 && lines.every(l => Number(l.quantity) > 0 && (l.max == null || Number(l.quantity) <= l.max + 1e-9));
export const cx = cn;
