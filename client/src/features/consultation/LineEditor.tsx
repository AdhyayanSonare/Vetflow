import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { DialogActions, ResponsiveDialog } from "@/components/common/ResponsiveDialog";
import { TextField } from "@/components/common/Fields";
import { Button } from "@/components/ui/button";
import { ItemPicker } from "@/features/inventory/items/ItemPicker";
import { itemLabel, type Item } from "@/features/inventory/items/api";
import { ChipChoice } from "./components";
import { lineProblems, type Line } from "./logic";

const DOSE = ["½ tablet", "1 tablet", "2 tablets"];
const ROUTE = ["Oral", "SC", "IM", "IV", "Topical"];
const FREQUENCY = ["once daily", "twice daily", "three times daily"];
const DURATION = ["3 days", "5 days", "7 days", "10 days"];

/** Edit one prescription line: which catalogue item, how much, how often, for how long. */
export function LineEditor({ line, allergyNote, onChange, onRemove, onClose }: {
  line: Line | null;
  allergyNote?: string | null;
  onChange: (l: Line) => void;
  onRemove: (key: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Line | null>(line);
  const [unit, setUnit] = useState("");
  const [changingItem, setChangingItem] = useState(false);
  useEffect(() => { setDraft(line); setChangingItem(false); }, [line]);
  if (!draft) return null;

  const set = (patch: Partial<Line>) => setDraft(d => (d ? { ...d, ...patch } : d));
  const pick = (item: Item) => { set({ itemId: item.id, drugText: itemLabel(item), reason: null }); setUnit(item.unit); setChangingItem(false); };
  const problems = lineProblems(draft);
  const showPicker = !draft.itemId || changingItem;

  return (
    <ResponsiveDialog open={!!line} onOpenChange={o => { if (!o) onClose(); }} title="Edit medicine" description="Choose the catalogue item so stock can be dispensed from it.">
      <div className="space-y-4">
        {allergyNote && <p role="alert" className="rounded-md bg-danger-tint px-3 py-2 text-sm text-danger">Allergy on record: {allergyNote}</p>}

        <section className="space-y-2">
          <p className="text-[15px] font-medium">Medicine</p>
          {!showPicker ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-tint/50 p-3">
              <span className="font-medium">{draft.drugText}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setChangingItem(true)}>Change</Button>
            </div>
          ) : (
            <>
              {draft.drugText && !draft.itemId && <p className="text-sm text-muted-foreground">Heard as “{draft.drugText}”. {draft.reason ?? "Choose the matching catalogue item."}</p>}
              <ItemPicker value={draft.itemId} onPick={pick} autoFocus={!draft.drugText}
                suggested={draft.candidates.map(c => ({ itemId: c.itemId, name: c.name, strength: c.strength, unit: c.unit }))} />
            </>
          )}
        </section>

        <ChipChoice label="Dose" options={DOSE} value={draft.dose} onChange={v => set({ dose: v })} />
        <ChipChoice label="Route" options={ROUTE} value={draft.route} onChange={v => set({ route: v })} allowOther={false} />
        <ChipChoice label="How often" options={FREQUENCY} value={draft.frequency} onChange={v => set({ frequency: v })} />
        <ChipChoice label="For how long" options={DURATION} value={draft.duration} onChange={v => set({ duration: v })} />
        <TextField label={`Quantity to dispense${unit ? ` (${unit})` : ""}`} inputMode="decimal" className="num" value={draft.quantity} onChange={e => set({ quantity: e.target.value })}
          hint="Leave blank if the pharmacist should decide." error={draft.quantity.trim() && !(Number(draft.quantity) > 0) ? "Enter a number above 0." : undefined} />
        <TextField label="Instructions" placeholder="For example: give after food" value={draft.instructions} onChange={e => set({ instructions: e.target.value })} />
      </div>

      <DialogActions>
        <Button type="button" variant="secondary" className="text-danger" onClick={() => { onRemove(draft.key); onClose(); }}><Trash2 /> Remove</Button>
        <Button type="button" onClick={() => { onChange(draft); onClose(); }} disabled={!draft.drugText.trim()} title={problems[0]}>Done</Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
