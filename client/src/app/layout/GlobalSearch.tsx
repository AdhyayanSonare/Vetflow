import { useQuery } from "@tanstack/react-query";
import { PawPrint, Pill } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { api } from "@/api/client";
import { SearchInput } from "@/components/common/SearchInput";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/features/auth/AuthProvider";
import { useDebounce } from "@/hooks/useMedia";
import { qty } from "@/lib/format";

type AnimalHit = { id: string; name: string; code: string; species: string; ownerName: string };
type ItemHit = { id: string; code: string; genericName: string; strength: string | null; unit: string; onHand: number };

/** Find a patient or a medicine from anywhere. A barcode scanner types into this box like a keyboard, so scanning finds the item. */
export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { can } = useAuth();
  const [, navigate] = useLocation();
  const [text, setText] = useState("");
  const q = useDebounce(text.trim(), 250);

  const animals = useQuery({
    queryKey: ["search", "animals", q],
    queryFn: () => api.get<AnimalHit[]>("/api/animals", { q }),
    enabled: open && q.length >= 2 && can("clinical.read"),
  });
  const items = useQuery({
    queryKey: ["search", "items", q],
    queryFn: () => api.get<ItemHit[]>("/api/items", { q, limit: 8 }),
    enabled: open && q.length >= 2 && can("catalogue.read"),
  });

  const go = (to: string) => { onOpenChange(false); setText(""); navigate(to); };
  const nothing = q.length >= 2 && !animals.isFetching && !items.isFetching && !(animals.data?.length) && !(items.data?.length);

  return (
    <Dialog open={open} onOpenChange={o => { onOpenChange(o); if (!o) setText(""); }}>
      <DialogContent className="top-[12%] translate-y-0 gap-3 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Search</DialogTitle>
          <DialogDescription>Patients by name, owner, phone or ID. Medicines by name, code or barcode.</DialogDescription>
        </DialogHeader>
        <SearchInput value={text} onChange={setText} autoFocus placeholder="Type to search" />
        <div className="max-h-[50dvh] overflow-y-auto" aria-live="polite">
          {(animals.data?.length ?? 0) > 0 && (
            <>
              <p className="px-1 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Patients</p>
              <ul>{animals.data!.slice(0, 6).map(a => (
                <li key={a.id}><button type="button" onClick={() => go(`/patients/${a.id}`)} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-tint">
                  <PawPrint className="size-5 shrink-0 text-muted-foreground" /><span className="min-w-0"><span className="block truncate font-medium">{a.name} <span className="font-normal text-muted-foreground">· {a.species}</span></span><span className="block truncate text-sm text-muted-foreground">{a.ownerName} · <span className="num">{a.code}</span></span></span>
                </button></li>
              ))}</ul>
            </>
          )}
          {(items.data?.length ?? 0) > 0 && (
            <>
              <p className="px-1 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Medicines and supplies</p>
              <ul>{items.data!.map(i => (
                <li key={i.id}><button type="button" onClick={() => go(`/inventory/items/${i.id}`)} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-tint">
                  <Pill className="size-5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{i.genericName}{i.strength ? ` ${i.strength}` : ""}</span><span className="block truncate text-sm text-muted-foreground"><span className="num">{i.code}</span> · {qty(i.onHand, i.unit)} on hand</span></span>
                </button></li>
              ))}</ul>
            </>
          )}
          {nothing && <p className="px-2 py-6 text-center text-muted-foreground">No matches for “{q}”.</p>}
          {q.length < 2 && <p className="px-2 py-6 text-center text-sm text-muted-foreground">Type at least two characters.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
