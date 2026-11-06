import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ApiError, errorMessage } from "@/api/client";
import { CheckRow, NativeSelect, TextField } from "@/components/common/Fields";
import { DialogActions, ResponsiveDialog } from "@/components/common/ResponsiveDialog";
import { Button } from "@/components/ui/button";
import { useSuppliers } from "@/features/inventory/suppliers/api";
import { itemLabel, useCategories, useCreateItem, useUpdateItem, type Item } from "./api";

const UNITS = ["tablet", "capsule", "ml", "vial", "ampoule", "bottle", "bag", "box", "pack", "pipette", "dose", "roll", "each"];

const num = (label: string) => z.string().trim().optional().transform(v => (v === undefined || v === "" ? undefined : Number(v)))
  .refine(v => v === undefined || (Number.isFinite(v) && v >= 0), `${label} must be a number, 0 or more.`);
const text = z.string().trim().optional().transform(v => v || undefined);

const schema = z.object({
  genericName: z.string().trim().min(1, "Enter the medicine or product name."),
  brandName: text, strength: text,
  unit: z.string().trim().min(1, "Choose or type the unit."),
  manufacturer: text,
  categoryId: text, defaultSupplierId: text,
  minQty: num("Minimum"), reorderQty: num("Reorder quantity"),
  storageLocation: text, barcode: text,
  controlled: z.boolean(), multiDose: z.boolean(),
  doseVolumeMl: z.string().trim().optional().transform(v => (v ? Number(v) : undefined)).refine(v => v === undefined || (Number.isFinite(v) && v > 0), "Enter the volume in ml."),
  beyondUseDays: z.string().trim().optional().transform(v => (v ? Number(v) : undefined)).refine(v => v === undefined || (Number.isInteger(v) && v > 0), "Enter a whole number of days."),
  active: z.boolean(),
}).refine(v => !v.multiDose || !!v.doseVolumeMl, { path: ["doseVolumeMl"], message: "A multi-dose container needs its volume in ml." });
type In = z.input<typeof schema>;
type Out = z.output<typeof schema>;

type Similar = { id: string; code: string; genericName: string; strength: string | null; unit: string; score: number };

/** Add or edit a catalogue item. Warns about near-duplicates before saving, using the server's name matching. */
export function ItemFormDialog({ open, onOpenChange, item, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; item?: Item | null; onSaved?: (i: Item) => void }) {
  const create = useCreateItem();
  const update = useUpdateItem(item?.id ?? "");
  const cats = useCategories();
  const suppliers = useSuppliers();
  const [error, setError] = useState<string | null>(null);
  const [similar, setSimilar] = useState<{ items: Similar[]; exact: boolean } | null>(null);
  const defaults = (i?: Item | null): In => ({
    genericName: i?.genericName ?? "", brandName: i?.brandName ?? "", strength: i?.strength ?? "", unit: i?.unit ?? "tablet", manufacturer: i?.manufacturer ?? "",
    categoryId: i?.categoryId ?? "", defaultSupplierId: i?.defaultSupplierId ?? "", minQty: i ? String(i.minQty) : "", reorderQty: i ? String(i.reorderQty) : "",
    storageLocation: i?.storageLocation ?? "", barcode: i?.barcode ?? "", controlled: i?.controlled ?? false, multiDose: i?.multiDose ?? false,
    doseVolumeMl: i?.doseVolumeMl ? String(i.doseVolumeMl) : "", beyondUseDays: i?.beyondUseDays ? String(i.beyondUseDays) : "", active: i?.active ?? true,
  });
  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<In, unknown, Out>({ resolver: zodResolver(schema), defaultValues: defaults(item) });
  useEffect(() => { if (open) { reset(defaults(item)); setError(null); setSimilar(null); } }, [open, item]); // eslint-disable-line react-hooks/exhaustive-deps
  const multiDose = watch("multiDose");

  const save = (confirmSimilar = false) => handleSubmit(async v => {
    setError(null);
    const body = { ...v, brandName: v.brandName ?? null, strength: v.strength ?? null, manufacturer: v.manufacturer ?? null, categoryId: v.categoryId ?? null,
      defaultSupplierId: v.defaultSupplierId ?? null, storageLocation: v.storageLocation ?? null, barcode: v.barcode ?? null, minQty: v.minQty ?? 0, reorderQty: v.reorderQty ?? 0,
      doseVolumeMl: v.multiDose ? v.doseVolumeMl ?? null : null, beyondUseDays: v.multiDose ? v.beyondUseDays ?? null : null };
    try {
      const saved = item ? await update.mutateAsync(body) : await create.mutateAsync({ ...body, confirmSimilar });
      toast.success(item ? "Item updated." : `${itemLabel(saved)} added as ${saved.code}.`);
      onOpenChange(false);
      onSaved?.(saved);
    } catch (e) {
      if (e instanceof ApiError && e.code === "similar_items") setSimilar({ items: (e.details?.similar as Similar[]) ?? [], exact: !!e.details?.exact });
      else setError(errorMessage(e));
    }
  });

  const busy = create.isPending || update.isPending;
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} size="lg" title={item ? `Edit ${itemLabel(item)}` : "Add an item"} description={item ? item.code : "The item code is made for you. A barcode is optional."}>
      <form onSubmit={save(false)} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Name" required autoFocus error={errors.genericName?.message} {...register("genericName")} />
          <TextField label="Strength" placeholder="For example 50 mg or 10 mg/ml" {...register("strength")} />
          <TextField label="Brand name" {...register("brandName")} />
          <TextField label="Unit" required list="units" error={errors.unit?.message} {...register("unit")} />
          <datalist id="units">{UNITS.map(u => <option key={u} value={u} />)}</datalist>
          <NativeSelect label="Category" {...register("categoryId")}><option value="">None</option>{cats.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
          <NativeSelect label="Usual supplier" {...register("defaultSupplierId")}><option value="">None</option>{suppliers.data?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect>
          <TextField label="Minimum stock" inputMode="decimal" hint="Alerts when stock is at or below this." error={errors.minQty?.message} {...register("minQty")} />
          <TextField label="Reorder quantity" inputMode="decimal" error={errors.reorderQty?.message} {...register("reorderQty")} />
          <TextField label="Storage location" placeholder="For example Shelf A2" {...register("storageLocation")} />
          <TextField label="Manufacturer" {...register("manufacturer")} />
          <TextField label="Barcode" className="num" hint="Optional. You can always add stock without one." error={errors.barcode?.message} {...register("barcode")} />
        </div>
        <div className="space-y-1">
          <CheckRow label="Controlled medicine" description="A second person must confirm each time it is dispensed." {...register("controlled")} />
          <CheckRow label="Multi-dose container" description="A vial opened once and used over several doses." {...register("multiDose")} />
          {item && <CheckRow label="Active" description="Inactive items are hidden from searches and cannot be ordered." {...register("active")} />}
        </div>
        {multiDose && (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Container volume (ml)" inputMode="decimal" error={errors.doseVolumeMl?.message} {...register("doseVolumeMl")} />
            <TextField label="Use within (days after opening)" inputMode="numeric" error={errors.beyondUseDays?.message} {...register("beyondUseDays")} />
          </div>
        )}

        {similar && (
          <div role="alert" className="space-y-2 rounded-lg border border-warn/40 bg-warn-tint p-3">
            <p className="font-medium text-warn">{similar.exact ? "This item already exists." : "Similar items already exist."}</p>
            <ul className="space-y-1 text-sm">{similar.items.map(s => <li key={s.id}><span className="num">{s.code}</span> {s.genericName}{s.strength ? ` ${s.strength}` : ""} · {s.unit}</li>)}</ul>
            {!similar.exact && <Button type="button" variant="secondary" size="sm" onClick={() => void save(true)()}>It is different. Add it anyway.</Button>}
          </div>
        )}
        {error && <p role="alert" className="rounded-md bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p>}
        <DialogActions>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />}{item ? "Save changes" : "Add item"}</Button>
        </DialogActions>
      </form>
    </ResponsiveDialog>
  );
}
