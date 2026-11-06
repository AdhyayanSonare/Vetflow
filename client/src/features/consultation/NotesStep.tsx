import { ChevronRight, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/api/client";
import { TextAreaField, TextField } from "@/components/common/Fields";
import { Button } from "@/components/ui/button";
import { clock, isStated, type NotesDraft } from "./logic";
import { ActionBar, PatientStrip, StepHeader } from "./components";
import type { ConsultationFlow } from "./useConsultationFlow";

const FIELDS: Array<{ key: keyof NotesDraft; label: string; rows?: number }> = [
  { key: "complaint", label: "Chief complaint" },
  { key: "durationText", label: "How long" },
  { key: "examination", label: "Examination", rows: 3 },
  { key: "diagnosis", label: "Diagnosis" },
  { key: "treatmentPlan", label: "Treatment plan", rows: 3 },
  { key: "followUpNote", label: "Follow-up" },
];

/** Step 2: review and correct the drafted notes. Blank means it was not said. */
export function NotesStep({ flow }: { flow: ConsultationFlow }) {
  const { notes, transcript, phase } = flow;
  const [busy, setBusy] = useState(false);
  const fromVoice = flow.consultation.source === "voice" || !!transcript;

  const save = async (next?: () => void) => {
    setBusy(true);
    try { await flow.persistNotes(); if (next) next(); else toast.success("Notes saved."); }
    catch (e) { toast.error(errorMessage(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-xl">
      <StepHeader step={2} title="Review notes" onBack={() => flow.setPhase(transcript ? "drafted" : "ready")} />
      <PatientStrip animalId={flow.consultation.animalId} />
      {fromVoice && <p className="mb-4 flex items-center gap-2 text-sm text-muted-foreground"><Sparkles className="size-4 shrink-0" /> Drafted from the conversation. A blank field means it was not mentioned. You decide what goes on the record.</p>}
      {transcript && (
        <details className="mb-4 rounded-xl border border-border bg-card">
          <summary className="flex min-h-12 cursor-pointer items-center justify-between px-4 font-medium">Transcript{flow.elapsed ? <span className="num text-sm text-muted-foreground">{clock(flow.elapsed)}</span> : null}<ChevronRight className="size-4" /></summary>
          <p className="whitespace-pre-wrap break-words px-4 pb-4 text-muted-foreground">{transcript}</p>
        </details>
      )}

      <div className="space-y-4">
        <TextField label="Temperature (°F)" inputMode="decimal" value={notes.temperatureF} onChange={e => flow.updateNotes({ temperatureF: e.target.value })} wrapperClassName="max-w-[10rem]" className="num" />
        {FIELDS.map(f => {
          const stated = isStated(notes[f.key]);
          const needsYou = f.key === "diagnosis" && !stated;
          return (
            <TextAreaField key={f.key} label={f.label} rows={f.rows ?? 2} value={notes[f.key]} onChange={e => flow.updateNotes({ [f.key]: e.target.value })}
              placeholder={f.key === "diagnosis" ? "Enter your diagnosis" : "Not mentioned"}
              hint={needsYou ? <span className="text-warn">Needs your confirmation. It is never filled in for you.</span> : stated && fromVoice ? "From the recording" : undefined} />
          );
        })}
      </div>

      <ActionBar>
        <Button variant="secondary" size="lg" disabled={busy || phase === "done"} onClick={() => void save()}>{busy && <Loader2 className="animate-spin" />}Save</Button>
        <Button size="lg" disabled={busy} onClick={() => void save(() => flow.setPhase("prescription"))}>Next: prescription <ChevronRight /></Button>
      </ActionBar>
    </div>
  );
}
