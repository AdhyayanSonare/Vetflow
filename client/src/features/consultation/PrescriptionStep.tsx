import { AlertTriangle, Check, ChevronRight, Loader2, Pill, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/api/client";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { usePatient, } from "@/features/patients/api";
import { allergyConflicts, isStated, lineProblems, lineSummary, type Line } from "./logic";
import { ActionBar, PatientStrip, StepHeader } from "./components";
import { LineEditor } from "./LineEditor";
import type { ConsultationFlow } from "./useConsultationFlow";

/** Step 3: the medicines. Only a vet can approve. Approving is what makes the prescription real. */
export function PrescriptionStep({ flow }: { flow: ConsultationFlow }) {
  const { lines, notes } = flow;
  const confirm = useConfirm();
  const patient = usePatient(flow.consultation.animalId).data;
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const editing = lines.find(l => l.key === editingKey) ?? null;
  const conflicts = useMemo(() => allergyConflicts(lines, patient?.allergies), [lines, patient?.allergies]);
  const conflictKeys = new Set(conflicts.map(c => c.key));

  const replace = (l: Line) => flow.setLines(ls => ls.map(x => (x.key === l.key ? l : x)));
  const remove = (key: string) => flow.setLines(ls => ls.filter(x => x.key !== key));
  const add = () => setEditingKey(flow.addBlankLine());

  const saveDraft = async () => {
    try { await flow.persistNotes(); await flow.saveDraft(); toast.success("Draft saved."); }
    catch (e) { toast.error(errorMessage(e)); }
  };

  const approve = async () => {
    const open = flow.linesNeedingAttention;
    if (open.length) {
      toast.error(`${open.length === 1 ? "One medicine needs" : `${open.length} medicines need`} attention: ${lineProblems(open[0])[0]}`);
      setEditingKey(open[0].key);
      return;
    }
    const ok = await confirm({
      title: "Approve this prescription?",
      description: (
        <div className="space-y-3 text-left">
          <ul className="divide-y divide-border rounded-md border border-border">
            {lines.map(l => <li key={l.key} className="p-2.5"><span className="block font-medium text-foreground">{l.drugText}</span><span className="block text-sm">{lineSummary(l)}</span></li>)}
          </ul>
          {patient?.allergies && <p className="rounded-md bg-warn-tint p-2.5 text-sm text-warn">Allergy on record: {patient.allergies}. {conflicts.length ? "One or more medicines may conflict. Check before approving." : "The name check found no conflict, but always review the record."}</p>}
          <p className="text-sm">Approving adds this to {patient?.name ?? "the patient"}'s record and lets the pharmacy dispense it. It cannot be edited afterwards.</p>
        </div>
      ),
      confirmLabel: "Approve",
    });
    if (!ok) return;
    try { await flow.approve(); toast.success("Prescription approved."); }
    catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <div className="mx-auto max-w-xl">
      <StepHeader step={3} title="Prescription" onBack={() => flow.setPhase("notes")} />
      <PatientStrip animalId={flow.consultation.animalId} withOwner />
      <dl className="mb-4 rounded-xl border border-border bg-card p-4">
        <dt className="text-sm text-muted-foreground">Diagnosis</dt>
        <dd>{isStated(notes.diagnosis) ? notes.diagnosis : <span className="text-warn">Not confirmed yet</span>}</dd>
      </dl>

      {conflicts.length > 0 && (
        <p role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-tint p-3 text-danger">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" /> A medicine name matches the allergy on record ({patient?.allergies}). This is a name check only. Review it before approving.
        </p>
      )}

      <div className="mb-2 flex items-end justify-between"><h2>Medicines</h2>{lines.length > 0 && <span className="text-sm text-muted-foreground">Tap a medicine to edit</span>}</div>
      <ul className="mb-4 divide-y divide-border rounded-xl border border-border bg-card">
        {lines.length === 0 && <li className="p-4 text-muted-foreground">No medicines yet. Add one, or finish without a prescription.</li>}
        {lines.map(l => {
          const problems = lineProblems(l);
          return (
            <li key={l.key}>
              <button type="button" onClick={() => setEditingKey(l.key)} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-tint/50">
                <Pill className="size-5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-medium">{l.drugText || "New medicine"}</span>
                  <span className="block break-words text-sm text-muted-foreground">{lineSummary(l)}{l.quantity ? ` · ${l.quantity} to dispense` : ""}</span>
                  {problems.length > 0 && <StatusBadge tone="warn" className="mt-1">{problems[0]}</StatusBadge>}
                  {conflictKeys.has(l.key) && <StatusBadge tone="danger" className="ml-1 mt-1">Allergy check</StatusBadge>}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          );
        })}
        <li><button type="button" onClick={add} className="flex min-h-14 w-full items-center gap-3 px-4 text-left text-primary hover:bg-tint/50"><Plus className="size-5" /> {lines.length ? "Add a medicine" : "Add medicine"}</button></li>
      </ul>

      {(notes.treatmentPlan || notes.followUpNote) && (
        <div className="mb-4 rounded-xl border border-border bg-card p-4"><h3 className="mb-1">Advice</h3><p className="break-words">{[notes.treatmentPlan, notes.followUpNote && `Follow-up: ${notes.followUpNote}`].filter(Boolean).join(" ")}</p></div>
      )}

      <p className="mb-2 flex items-center gap-2 text-sm"><StatusBadge tone="warn">Draft</StatusBadge><span className="text-muted-foreground">Not approved yet. Nothing is dispensed until a vet approves.</span></p>
      {!flow.canApprove && <p className="mb-2 text-sm text-muted-foreground">Your role can save this draft. A vet approves it.</p>}

      <ActionBar>
        <Button variant="secondary" size="lg" disabled={flow.saving} onClick={() => void saveDraft()}>Save draft</Button>
        {flow.canApprove && (lines.length > 0
          ? <Button size="lg" disabled={flow.saving} onClick={() => void approve()}>{flow.saving ? <Loader2 className="animate-spin" /> : <Check />} Approve</Button>
          : <Button size="lg" disabled={flow.saving} onClick={() => void flow.finishWithoutPrescription().catch(e => toast.error(errorMessage(e)))}>Finish, no prescription</Button>)}
      </ActionBar>

      <LineEditor line={editing} allergyNote={editing && conflictKeys.has(editing.key) ? patient?.allergies : null} onChange={replace} onRemove={remove} onClose={() => setEditingKey(null)} />
    </div>
  );
}
