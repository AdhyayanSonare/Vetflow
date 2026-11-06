import { Check, ChevronRight, FileText, MessageCircle, Printer } from "lucide-react";
import { Link } from "wouter";
import { LoadingState } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { usePatient } from "@/features/patients/api";
import { whatsappLink } from "@/features/patients/components";
import { usePrescription } from "@/features/prescriptions/api";
import { dateIST } from "@/lib/format";
import { lineSummary } from "./logic";
import { fromSaved } from "./logic";
import type { ConsultationFlow } from "./useConsultationFlow";

/** The summary after approval: what was prescribed, and how to hand it to the owner. */
export function DoneStep({ flow }: { flow: ConsultationFlow }) {
  const c = flow.consultation;
  const patient = usePatient(c.animalId).data;
  const rx = usePrescription(flow.prescriptionId);
  if (flow.prescriptionId && rx.isPending) return <div className="mx-auto max-w-xl"><LoadingState rows={3} /></div>;

  const lines = (rx.data?.lines ?? []).map(fromSaved);
  const summary = patient && rx.data
    ? `${patient.name}: prescription from ${rx.data.clinicName}, ${dateIST(rx.data.approvedAt ?? rx.data.createdAt)}.\n${lines.map(l => `• ${l.drugText}: ${lineSummary(l)}${l.instructions ? ` (${l.instructions})` : ""}`).join("\n")}${c.followUpNote ? `\nFollow-up: ${c.followUpNote}.` : ""}`
    : "";
  const share = patient ? whatsappLink(patient.ownerPhone, summary) : null;

  return (
    <div className="mx-auto max-w-xl">
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-ok text-white dark:text-[#0b1421]"><Check className="size-7" /></span>
        <h1>{rx.data ? "Prescription approved" : "Consultation saved"}</h1>
        <p className="text-muted-foreground">{patient?.name} · {patient?.ownerName} · {dateIST(c.completedAt ?? c.startedAt)}</p>
      </div>

      {lines.length > 0 ? (
        <ul className="mb-5 divide-y divide-border rounded-xl border border-border bg-card">
          {lines.map(l => <li key={l.key} className="p-3.5"><span className="block font-medium">{l.drugText}</span><span className="block text-sm text-muted-foreground">{lineSummary(l)}</span></li>)}
        </ul>
      ) : <p className="mb-5 rounded-xl border border-border bg-card p-4 text-muted-foreground">No medicines were prescribed.</p>}

      <h2 className="mb-2">Next steps</h2>
      <ul className="mb-24 divide-y divide-border rounded-xl border border-border bg-card md:mb-6">
        {share && <li><a href={share} target="_blank" rel="noreferrer" className="flex min-h-14 items-center gap-3 px-4 hover:bg-tint/50"><MessageCircle className="size-5 text-muted-foreground" /><span className="flex-1"><span className="block font-medium">Share with the owner</span><span className="block text-sm text-muted-foreground">Opens WhatsApp with the details ready to send</span></span><ChevronRight className="size-4 text-muted-foreground" /></a></li>}
        {rx.data && <li><Link href={`/prescriptions/${rx.data.id}?print=1`} className="flex min-h-14 items-center gap-3 px-4 hover:bg-tint/50"><Printer className="size-5 text-muted-foreground" /><span className="flex-1 font-medium">Print or save as PDF</span><ChevronRight className="size-4 text-muted-foreground" /></Link></li>}
        {patient && <li><Link href={`/patients/${patient.id}`} className="flex min-h-14 items-center gap-3 px-4 hover:bg-tint/50"><FileText className="size-5 text-muted-foreground" /><span className="flex-1 font-medium">Open {patient.name}'s record</span><ChevronRight className="size-4 text-muted-foreground" /></Link></li>}
      </ul>

      <div className="no-print fixed inset-x-0 bottom-[calc(var(--nav-h)+env(safe-area-inset-bottom))] z-30 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
        <div className="mx-auto flex max-w-xl gap-2 [&>*]:flex-1">
          <Button asChild variant="secondary" size="lg"><Link href="/">Back to Today</Link></Button>
          <Button asChild size="lg"><Link href="/consult/new">Next consultation <ChevronRight /></Link></Button>
        </div>
      </div>
    </div>
  );
}
