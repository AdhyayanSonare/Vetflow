import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { errorMessage } from "@/api/client";
import { DataTable } from "@/components/common/DataTable";
import { TextField } from "@/components/common/Fields";
import { DialogActions, ResponsiveDialog } from "@/components/common/ResponsiveDialog";
import { EmptyState, QueryBoundary } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/AuthProvider";
import { money } from "@/lib/format";
import { parseRupees, rupeesText } from "@/lib/money";
import { InventoryShell } from "../InventoryShell";
import { useSaveSupplier, useSuppliers, type Supplier } from "./api";

const optional = z.string().trim().optional().transform(v => v || undefined);
const schema = z.object({
  name: z.string().trim().min(1, "Enter the supplier's name."),
  contactName: optional, phone: optional,
  email: z.string().trim().optional().refine(v => !v || /^\S+@\S+\.\S+$/.test(v), "Enter a valid email address.").transform(v => v || undefined),
  address: optional,
  gstin: z.string().trim().toUpperCase().optional().refine(v => !v || /^[0-9A-Z]{15}$/.test(v), "A GSTIN has 15 letters and numbers.").transform(v => v || undefined),
  paymentTerms: optional,
  outstanding: z.string().trim().optional().refine(v => !v || parseRupees(v) !== null, "Enter an amount in rupees."),
});
type In = z.input<typeof schema>;
type Out = z.output<typeof schema>;

function SupplierDialog({ supplier, open, onClose }: { supplier: Supplier | null; open: boolean; onClose: () => void }) {
  const save = useSaveSupplier(supplier?.id);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<In, unknown, Out>({ resolver: zodResolver(schema) });
  useEffect(() => {
    if (open) { reset({ name: supplier?.name ?? "", contactName: supplier?.contactName ?? "", phone: supplier?.phone ?? "", email: supplier?.email ?? "", address: supplier?.address ?? "", gstin: supplier?.gstin ?? "", paymentTerms: supplier?.paymentTerms ?? "", outstanding: rupeesText(supplier?.outstandingPaise) }); setError(null); }
  }, [open, supplier, reset]);
  const submit = handleSubmit(async v => {
    setError(null);
    try {
      await save.mutateAsync({ name: v.name, contactName: v.contactName, phone: v.phone, email: v.email, address: v.address, gstin: v.gstin, paymentTerms: v.paymentTerms, outstandingPaise: v.outstanding ? parseRupees(v.outstanding)! : 0 });
      toast.success(supplier ? "Supplier updated." : "Supplier added.");
      onClose();
    } catch (e) { setError(errorMessage(e)); }
  });
  return (
    <ResponsiveDialog open={open} onOpenChange={o => { if (!o) onClose(); }} size="lg" title={supplier ? `Edit ${supplier.name}` : "Add a supplier"} description="Purchase history and the amount owed are kept here. This is not an accounting system.">
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Name" required autoFocus error={errors.name?.message} {...register("name")} />
          <TextField label="Contact person" {...register("contactName")} />
          <TextField label="Phone" type="tel" inputMode="tel" {...register("phone")} />
          <TextField label="Email" type="email" inputMode="email" error={errors.email?.message} {...register("email")} />
          <TextField label="GSTIN (optional)" className="num" error={errors.gstin?.message} {...register("gstin")} />
          <TextField label="Payment terms" placeholder="For example 30 days" {...register("paymentTerms")} />
          <TextField label="Amount owed (₹)" inputMode="decimal" className="num" hint="Recorded by hand." error={errors.outstanding?.message} {...register("outstanding")} />
          <TextField label="Address" {...register("address")} />
        </div>
        {error && <p role="alert" className="rounded-md bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p>}
        <DialogActions><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={save.isPending}>{save.isPending && <Loader2 className="animate-spin" />}Save supplier</Button></DialogActions>
      </form>
    </ResponsiveDialog>
  );
}

export default function SuppliersPage() {
  const { can } = useAuth();
  const list = useSuppliers();
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [open, setOpen] = useState(false);
  const edit = (s: Supplier | null) => { setEditing(s); setOpen(true); };
  return (
    <InventoryShell title="Suppliers" description="Who you buy from, with contact details and the amount owed."
      actions={can("suppliers.write") ? <Button onClick={() => edit(null)}><Plus /> Add supplier</Button> : undefined}>
      <QueryBoundary query={list} empty={{ when: r => r.length === 0, element: <EmptyState title="No suppliers yet" action={can("suppliers.write") ? <Button onClick={() => edit(null)}><Plus /> Add supplier</Button> : undefined} /> }}>
        {rows => (
          <DataTable<Supplier> caption="Suppliers" rows={rows} rowKey={s => s.id} onRowClick={can("suppliers.write") ? s => edit(s) : undefined}
            columns={[
              { key: "name", header: "Supplier", primary: true, cell: s => <span>{s.name}<span className="block text-sm font-normal text-muted-foreground">{s.contactName ?? ""}</span></span> },
              { key: "phone", header: "Phone", cell: s => <span className="num">{s.phone ?? "—"}</span> },
              { key: "terms", header: "Terms", hideOnPhone: true, cell: s => s.paymentTerms ?? "—" },
              { key: "owed", header: "Owed", align: "right", cell: s => <span className="num">{s.outstandingPaise ? money(s.outstandingPaise) : "—"}</span> },
            ]} />
        )}
      </QueryBoundary>
      <SupplierDialog supplier={editing} open={open} onClose={() => setOpen(false)} />
    </InventoryShell>
  );
}
