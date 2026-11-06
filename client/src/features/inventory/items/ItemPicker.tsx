import { Check } from "lucide-react";
import { useState } from "react";
import { SearchInput } from "@/components/common/SearchInput";
import { useDebounce } from "@/hooks/useMedia";
import { qty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { itemLabel, useItems, type Item } from "./api";

/**
 * Search the catalogue and pick one item. Type a name, a code, or scan a barcode (a scanner types into
 * the box like a keyboard, so scanning finds the item). `suggested` shows likely matches first.
 */
export function ItemPicker({ value, onPick, suggested = [], autoFocus, showStock = true, placeholder = "Search medicines and supplies" }: {
  value?: string | null;
  onPick: (item: Item) => void;
  suggested?: Array<{ itemId: string; name: string; strength: string | null; unit: string }>;
  autoFocus?: boolean;
  showStock?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const q = useDebounce(text.trim(), 250);
  const items = useItems({ q, limit: 12 }, q.length >= 2);

  return (
    <div className="space-y-2">
      {suggested.length > 0 && q.length < 2 && (
        <div>
          <p className="mb-1 text-sm text-muted-foreground">Likely matches</p>
          <ul className="space-y-1">{suggested.map(s => (
            <li key={s.itemId}>
              <button type="button" onClick={() => onPick({ id: s.itemId, genericName: s.name, strength: s.strength, unit: s.unit } as Item)}
                className={cn("flex min-h-12 w-full items-center justify-between gap-2 rounded-md border px-3 text-left", value === s.itemId ? "border-primary bg-tint" : "border-border")}>
                <span className="font-medium">{s.name}{s.strength ? ` ${s.strength}` : ""}</span>{value === s.itemId && <Check className="size-5 text-primary" />}
              </button>
            </li>))}</ul>
        </div>
      )}
      <SearchInput value={text} onChange={setText} autoFocus={autoFocus} placeholder={placeholder} />
      {q.length >= 2 && (
        <ul className="max-h-60 space-y-1 overflow-y-auto" aria-live="polite">
          {items.data?.map(i => (
            <li key={i.id}>
              <button type="button" onClick={() => onPick(i)} className={cn("flex min-h-12 w-full items-center justify-between gap-3 rounded-md border px-3 text-left", value === i.id ? "border-primary bg-tint" : "border-border hover:bg-tint/50")}>
                <span className="min-w-0"><span className="block truncate font-medium">{itemLabel(i)}</span><span className="num block truncate text-sm text-muted-foreground">{i.code}{i.brandName ? ` · ${i.brandName}` : ""}</span></span>
                {showStock && <span className={cn("num shrink-0 text-sm", (i.onHand ?? 0) <= 0 ? "text-danger" : "text-muted-foreground")}>{qty(i.onHand ?? 0, i.unit)}</span>}
              </button>
            </li>
          ))}
          {items.data?.length === 0 && !items.isFetching && <li className="px-2 py-3 text-sm text-muted-foreground">Nothing in the catalogue matches “{q}”.</li>}
        </ul>
      )}
    </div>
  );
}
