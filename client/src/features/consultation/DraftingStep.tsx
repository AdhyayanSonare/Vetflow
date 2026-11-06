import { AlertCircle, AudioLines, Check, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clock, isStated } from "./logic";
import { ActionBar, ErrorNote, PatientStrip, StepHeader } from "./components";
import type { ConsultationFlow } from "./useConsultationFlow";

type StepState = "done" | "active" | "todo" | "failed";

/** Shown while the recording is turned into text and then into a draft. A live checklist so the wait explains itself. */
export function DraftingStep({ flow }: { flow: ConsultationFlow }) {
  const { phase, draftStatus, draftError, notes, lines, elapsed, transcript } = flow;
  const transcribing = phase === "transcribing";
  const failed = draftStatus === "failed";
  const ready = phase === "drafted" && draftStatus === "done";
  const filled = Object.values(notes).filter(isStated).length;

  const steps: Array<{ label: string; sub: string; state: StepState }> = [
    { label: "Audio captured", sub: elapsed ? `${clock(elapsed)} recorded` : "Text received", state: "done" },
    { label: "Transcribing", sub: transcribing ? "Turning speech into text" : "Transcript ready", state: transcribing ? "active" : "done" },
    { label: "Drafting notes and prescription", sub: failed ? "Could not draft from this transcript" : ready ? "Draft ready for your review" : "Reading what was said", state: transcribing ? "todo" : failed ? "failed" : ready ? "done" : "active" },
  ];

  return (
    <div className="mx-auto max-w-xl">
      <StepHeader step={1} title={ready ? "Your draft is ready" : failed ? "Transcript ready" : "Working on it"} />
      <PatientStrip animalId={flow.consultation.animalId} />
      <p className="mb-4 text-muted-foreground">{ready ? "Everything below came from the conversation. Check it before it goes on the record." : failed ? "The notes could not be drafted. Try again, or fill them in from the transcript." : "Keep this screen open. It usually takes a few seconds."}</p>

      <ol className="mb-5 space-y-3" aria-live="polite">
        {steps.map(s => (
          <li key={s.label} className="flex items-start gap-3 rounded-xl border border-border bg-card p-3.5">
            <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full", s.state === "done" && "bg-ok text-white dark:text-[#0b1421]", s.state === "failed" && "bg-danger text-white dark:text-[#0b1421]", s.state === "active" && "text-primary", s.state === "todo" && "border border-border")}>
              {s.state === "done" ? <Check className="size-4" /> : s.state === "failed" ? <AlertCircle className="size-4" /> : s.state === "active" ? <Loader2 className="size-5 animate-spin" /> : null}
            </span>
            <span><span className="block font-medium">{s.label}</span><span className="block text-sm text-muted-foreground">{s.sub}</span></span>
          </li>
        ))}
      </ol>

      {transcript && (
        <figure className="mb-5 rounded-xl border border-border bg-card p-4">
          <figcaption className="mb-1 flex items-center gap-2 text-sm font-medium text-muted-foreground"><AudioLines className="size-4" /> Transcript</figcaption>
          <blockquote className="whitespace-pre-wrap break-words">{transcript}</blockquote>
        </figure>
      )}

      {ready && (
        <div className="mb-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-card p-4"><div className="num text-2xl">{filled}</div><div className="text-sm text-muted-foreground">note fields filled</div></div>
          <div className="rounded-xl border border-border bg-card p-4"><div className="num text-2xl">{lines.length}</div><div className="text-sm text-muted-foreground">{lines.length === 1 ? "medicine" : "medicines"} drafted</div></div>
        </div>
      )}
      {failed && <div className="mb-5"><ErrorNote message={draftError} action="Try again" onAction={flow.retryDraft} /></div>}

      <ActionBar>
        {failed
          ? <Button size="lg" onClick={() => flow.setPhase("notes")}>Fill in the notes myself</Button>
          : <Button size="lg" disabled={!ready} onClick={() => flow.setPhase("notes")}>{ready ? <>Review notes <ChevronRight /></> : <><Loader2 className="animate-spin" /> {transcribing ? "Transcribing" : "Drafting"}</>}</Button>}
      </ActionBar>
    </div>
  );
}
