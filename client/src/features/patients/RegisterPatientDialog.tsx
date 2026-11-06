import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { errorMessage } from "@/api/client";
import { DialogActions, ResponsiveDialog } from "@/components/common/ResponsiveDialog";
import { NativeSelect, TextAreaField, TextField } from "@/components/common/Fields";
import { SearchInput } from "@/components/common/SearchInput";
import { Button } from "@/components/ui/button";
import { useDebounce } from "@/hooks/useMedia";
import { cn } from "@/lib/utils";
import { SPECIES, useOwners, useRegisterPatient, type Animal } from "./api";

const optional = z.string().trim().optional().transform(v => v || undefined);
const schema = z.object({
  name: z.string().trim().min(1, "Enter the animal's name."),
  species: z.string().min(1, "Choose a species."),
  breed: optional,
  sex: optional,
  dob: optional,
  weightKg: z.string().trim().optional().transform(v => (v ? Number(v) : undefined)).refine(v => v === undefined || (Number.isFinite(v) && v > 0 && v < 2000), "Enter a weight in kilograms."),
  colour: optional,
  microchip: optional,
  allergies: optional,
  conditions: optional,
  ownerName: optional,
  ownerPhone: optional,
  ownerEmail: z.string().trim().optional().refine(v => !v || /^\S+@\S+\.\S+$/.test(v), "Enter a valid email address.").transform(v => v || undefined),
  ownerAddress: optional,
});
type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;

export function RegisterPatientDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (animal: Animal) => void }) {
  const register = useRegisterPatient();
  const [ownerMode, setOwnerMode] = useState<"new" | "existing">("new");
  const [ownerQuery, setOwnerQuery] = useState("");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debounced = useDebounce(ownerQuery.trim(), 250);
  const owners = useOwners(debounced, open && ownerMode === "existing");
  const { register: field, handleSubmit, reset, formState: { errors } } = useForm<FormIn, unknown, FormOut>({ resolver: zodResolver(schema), defaultValues: { species: "Dog" } });

  const close = () => { onOpenChange(false); reset({ species: "Dog" }); setOwnerMode("new"); setOwnerId(null); setOwnerQuery(""); setError(null); };

  const submit = handleSubmit(async v => {
    setError(null);
    if (ownerMode === "existing" && !ownerId) { setError("Choose the owner from the list, or switch to a new owner."); return; }
    if (ownerMode === "new" && !v.ownerName) { setError("Enter the owner's name."); return; }
    try {
      const animal = await register.mutateAsync({
        name: v.name, species: v.species, breed: v.breed, sex: v.sex, dob: v.dob, weightKg: v.weightKg, colour: v.colour, microchip: v.microchip,
        allergies: v.allergies, conditions: v.conditions,
        ...(ownerMode === "existing" ? { ownerId: ownerId! } : { owner: { name: v.ownerName!, phone: v.ownerPhone, email: v.ownerEmail, address: v.ownerAddress } }),
      });
      toast.success(`${animal.name} registered as ${animal.code}.`);
      close();
      onCreated(animal);
    } catch (e) { setError(errorMessage(e)); }
  });

  return (
    <ResponsiveDialog open={open} onOpenChange={o => (o ? onOpenChange(true) : close())} title="Register a patient" description="The ID is made for you when you save." size="lg">
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Name" required autoFocus error={errors.name?.message} {...field("name")} />
          <NativeSelect label="Species" required error={errors.species?.message} {...field("species")}>{SPECIES.map(s => <option key={s} value={s}>{s}</option>)}</NativeSelect>
          <TextField label="Breed" error={errors.breed?.message} {...field("breed")} />
          <NativeSelect label="Sex" {...field("sex")}><option value="">Not recorded</option><option>Male</option><option>Female</option></NativeSelect>
          <TextField label="Date of birth" type="date" error={errors.dob?.message} {...field("dob")} />
          <TextField label="Weight (kg)" inputMode="decimal" error={errors.weightKg?.message} {...field("weightKg")} />
          <TextField label="Colour" {...field("colour")} />
          <TextField label="Microchip ID" className="num" {...field("microchip")} />
        </div>
        <TextAreaField label="Known allergies" rows={2} placeholder="Leave blank if none are known" {...field("allergies")} />
        <TextAreaField label="Existing conditions" rows={2} {...field("conditions")} />

        <fieldset className="space-y-3 rounded-lg border border-border p-3">
          <legend className="px-1 font-medium">Owner</legend>
          <div role="radiogroup" aria-label="Owner" className="grid grid-cols-2 gap-2">
            {(["new", "existing"] as const).map(m => (
              <button key={m} type="button" role="radio" aria-checked={ownerMode === m} onClick={() => { setOwnerMode(m); setError(null); }}
                className={cn("min-h-11 rounded-md border text-[15px] font-medium", ownerMode === m ? "border-primary bg-tint text-primary" : "border-border text-muted-foreground")}>
                {m === "new" ? "New owner" : "Existing owner"}
              </button>
            ))}
          </div>
          {ownerMode === "new" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Owner name" required {...field("ownerName")} />
              <TextField label="Phone" type="tel" inputMode="tel" autoComplete="off" {...field("ownerPhone")} />
              <TextField label="Email" type="email" inputMode="email" error={errors.ownerEmail?.message} {...field("ownerEmail")} />
              <TextField label="Address" {...field("ownerAddress")} />
            </div>
          ) : (
            <div className="space-y-2">
              <SearchInput value={ownerQuery} onChange={setOwnerQuery} placeholder="Search owners by name or phone" />
              <ul className="max-h-48 space-y-1 overflow-y-auto">
                {owners.data?.map(o => (
                  <li key={o.id}>
                    <button type="button" onClick={() => setOwnerId(o.id)} aria-pressed={ownerId === o.id}
                      className={cn("flex min-h-12 w-full items-center justify-between gap-2 rounded-md border px-3 text-left", ownerId === o.id ? "border-primary bg-tint" : "border-border")}>
                      <span><span className="block font-medium">{o.name}</span><span className="block text-sm text-muted-foreground">{o.phone ?? "No phone"}</span></span>
                      <span className="text-sm text-muted-foreground">{o.animalCount} {o.animalCount === 1 ? "animal" : "animals"}</span>
                    </button>
                  </li>
                ))}
                {owners.data?.length === 0 && <li className="px-2 py-3 text-sm text-muted-foreground">No owners match.</li>}
              </ul>
            </div>
          )}
        </fieldset>

        {error && <p role="alert" className="rounded-md bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p>}
        <DialogActions>
          <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
          <Button type="submit" disabled={register.isPending}>{register.isPending && <Loader2 className="animate-spin" />}Register patient</Button>
        </DialogActions>
      </form>
    </ResponsiveDialog>
  );
}
