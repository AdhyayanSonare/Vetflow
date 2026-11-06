import { Check, ChevronLeft, Pill, Printer, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useRoute, useSearch } from "wouter";
import { toast } from "sonner";
import { errorMessage } from "@/api/client";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { TextField } from "@/components/common/Fields";
import { Page, PageHeader } from "@/components/common/Page";
import { DialogActions, ResponsiveDialog } from "@/components/common/ResponsiveDialog";
import { QueryBoundary } from "@/components/common/States";
import { StatusText } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/AuthProvider";
import { dateIST, dateTimeIST } from "@/lib/format";
import { lineSummary } from "@/features/consultation/logic";
import { fromSaved } from "@/features/consultation/logic";
import { useApprovePrescription, useCancelPrescription, usePrescription, type Prescription } from "./api";

function Document({ rx }: { rx: Prescription }) {
  return (
    <article className="print-sheet relative rounded-xl border border-border bg-card p-5 md:p-8">
      {rx.status === "draft" && <p className="mb-4 rounded-md bg-warn-tint px-3 py-2 text-sm font-medium text-warn">Draft. Not approved, and not valid until a vet approves it.</p>}
      {rx.status === "cancelled" && <p className="mb-4 rounded-md bg-danger-tint px-3 py-2 text-sm font-medium text-danger">Cancelled. Do not dispense.</p>}
      <header className="mb-5 flex flex-wrap items-start justify-between gap-2 border-b border-border pb-4">
        <div><p className="font-heading text-xl font-semibold">{rx.clinicName}</p><p className="text-sm text-muted-foreground">Prescription</p></div>
        <div className="text-right text-sm"><p className="num">{dateIST(rx.approvedAt ?? rx.createdAt)}</p><p className="num text-muted-foreground">{rx.animalCode}</p></div>
      </header>

      <dl className="mb-5 grid gap-x-8 gap-y-3 sm:grid-cols-2">
        <div><dt className="text-sm text-muted-foreground">Patient</dt><dd className="font-medium">{rx.animalName}</dd><dd className="text-sm">{[rx.species, rx.breed, rx.weightKg ? `${rx.weightKg} kg` : ""].filter(Boolean).join(" · ")}</dd></div>
        <div><dt className="text-sm text-muted-foreground">Owner</dt><dd className="font-medium">{rx.ownerName}</dd>{rx.ownerPhone && <dd className="num text-sm">{rx.ownerPhone}</dd>}</div>
        {rx.allergies && <div className="sm:col-span-2"><dt className="text-sm text-muted-foreground">Allergies on record</dt><dd className="font-medium text-danger">{rx.allergies}</dd></div>}
        {rx.diagnosis && <div className="sm:col-span-2"><dt className="text-sm text-muted-foreground">Diagnosis</dt><dd>{rx.diagnosis}</dd></div>}
      </dl>

      <h2 className="mb-2">Medicines</h2>
      <ol className="mb-5 divide-y divide-border rounded-md border border-border">
        {rx.lines.map((l, i) => {
          const line = fromSaved({ ...l });
          return (
            <li key={l.id} className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0"><p className="font-medium break-words"><span className="num mr-2 text-muted-foreground">{i + 1}.</span>{l.drugText}</p><p className="text-sm text-muted-foreground">{lineSummary(line)}</p>{l.instructions && <p className="text-sm">{l.instructions}</p>}</div>
              <div className="num shrink-0 text-right text-sm">{l.quantity != null ? <><span className="block">Qty {l.quantity}{l.unit ? ` ${l.unit}` : ""}</span>{rx.status === "approved" && <span className="block text-muted-foreground">{l.dispensed} dispensed</span>}</> : <span className="text-muted-foreground">Qty by pharmacist</span>}</div>
            </li>
          );
        })}
      </ol>

      {(rx.treatmentPlan || rx.followUpNote) && (
        <section className="mb-5"><h2 className="mb-1">Advice</h2><p className="break-words">{[rx.treatmentPlan, rx.followUpNote && `Follow-up: ${rx.followUpNote}`].filter(Boolean).join(" ")}</p></section>
      )}

      <footer className="border-t border-border pt-4 text-sm">
        <p><span className="text-muted-foreground">Prescribed by </span><span className="font-medium">{rx.vetName}</span></p>
        {rx.approvedByName && <p><span className="text-muted-foreground">Approved by </span><span className="font-medium">{rx.approvedByName}</span><span className="text-muted-foreground"> on {dateTimeIST(rx.approvedAt)}</span></p>}
      </footer>
    </article>
  );
}

export default function PrescriptionDetailPage() {
  const [, params] = useRoute<{ id: string }>("/prescriptions/:id");
  const q = usePrescription(params?.id);
  const { can } = useAuth();
  const confirm = useConfirm();
  const approve = useApprovePrescription();
  const cancel = useCancelPrescription();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const autoPrint = new URLSearchParams(useSearch()).get("print") === "1";
  const printed = useRef(false);

  // Arriving from "Print" on the done screen opens the print dialog once the document is on screen.
  useEffect(() => {
    if (autoPrint && q.data && !printed.current) { printed.current = true; setTimeout(() => window.print(), 400); }
  }, [autoPrint, q.data]);

  const doApprove = async (rx: Prescription) => {
    if (rx.lines.some(l => l.unmatched)) { toast.error("Match every medicine to the catalogue before approving. Open the consultation to fix it."); return; }
    if (!(await confirm({ title: "Approve this prescription?", description: "It goes to the pharmacy and cannot be edited afterwards.", confirmLabel: "Approve" }))) return;
    try { await approve.mutateAsync(rx.id); toast.success("Prescription approved."); } catch (e) { toast.error(errorMessage(e)); }
  };
  const doCancel = async (rx: Prescription) => {
    try { await cancel.mutateAsync({ id: rx.id, reason }); toast.success("Prescription cancelled."); setCancelling(false); setReason(""); } catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <Page>
      <QueryBoundary query={q}>
        {rx => (
          <>
            <PageHeader
              back={<Link href="/prescriptions" className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground no-print"><ChevronLeft className="size-4" /> Prescriptions</Link>}
              title={<span className="flex flex-wrap items-center gap-3">Prescription for {rx.animalName} <StatusText status={rx.status} /></span>}
              actions={
                <>
                  <Button variant="secondary" onClick={() => window.print()}><Printer /> Print</Button>
                  {rx.status === "draft" && can("prescription.approve") && <Button onClick={() => void doApprove(rx)} disabled={approve.isPending}><Check /> Approve</Button>}
                  {rx.status === "draft" && can("clinical.write") && <Button asChild variant="secondary"><Link href={`/consult/${rx.consultationId}`}>Edit in consultation</Link></Button>}
                  {rx.status === "approved" && can("dispense.write") && rx.lines.some(l => l.itemId && (l.quantity == null || l.quantity > l.dispensed)) && <Button asChild><Link href={`/dispensing?rx=${rx.id}`}><Pill /> Dispense</Link></Button>}
                  {rx.status !== "cancelled" && can("clinical.write") && <Button variant="ghost" className="text-danger" onClick={() => setCancelling(true)}><X /> Cancel</Button>}
                </>
              }
            />
            <Document rx={rx} />
            <ResponsiveDialog open={cancelling} onOpenChange={setCancelling} title="Cancel this prescription?" description="It can no longer be dispensed. Anything already dispensed stays in the record.">
              <TextField label="Reason" value={reason} onChange={e => setReason(e.target.value)} hint="At least 3 characters. This is saved in the audit log." />
              <DialogActions>
                <Button variant="secondary" onClick={() => setCancelling(false)}>Keep it</Button>
                <Button variant="destructive" disabled={reason.trim().length < 3 || cancel.isPending} onClick={() => void doCancel(rx)}>Cancel prescription</Button>
              </DialogActions>
            </ResponsiveDialog>
          </>
        )}
      </QueryBoundary>
    </Page>
  );
}
