import { Mic, Pause, Pencil, Play, Square, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { TextAreaField } from "@/components/common/Fields";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { cn } from "@/lib/utils";
import { clock } from "./logic";
import { ActionBar, ErrorNote, PatientStrip, StepHeader, Wave } from "./components";
import type { ConsultationFlow } from "./useConsultationFlow";

/** Step 1: capture what was said. Recording, an uploaded file, or typed text all lead to the same draft. */
export function RecordStep({ flow }: { flow: ConsultationFlow }) {
  const { phase, elapsed, voiceError, canRetry, canTranscribe, voiceOn } = flow;
  const confirm = useConfirm();
  const [typing, setTyping] = useState(!canTranscribe);
  const [text, setText] = useState("");
  const recording = phase === "recording";
  const paused = phase === "paused";
  const active = recording || paused;

  return (
    <div className="mx-auto max-w-xl">
      <StepHeader step={1} title="Record" />
      <PatientStrip animalId={flow.consultation.animalId} />

      {!voiceOn && (
        <p className="mb-4 rounded-lg border border-border bg-card p-3 text-muted-foreground">Voice is switched off for this clinic. Type a dictation below, or write the notes by hand.</p>
      )}
      {voiceOn && !canTranscribe && (
        <p className="mb-4 rounded-lg border border-border bg-card p-3 text-muted-foreground">Voice transcription is not set up on this server yet. You can still type or paste what was said, or write the notes yourself.</p>
      )}

      {canTranscribe && (
        <div className="flex flex-col items-center gap-3 py-6">
          <div className={cn("num text-5xl font-medium tabular-nums", !active && "text-muted-foreground")} role="timer" aria-label={`${elapsed} seconds recorded`}>{clock(elapsed)}</div>
          <div aria-live="polite" className="min-h-7 text-center">
            {phase === "ready" && !voiceError && <p className="max-w-xs text-muted-foreground">Talk through the examination as you normally would. Vetflow drafts the notes and prescription for you to review.</p>}
            {recording && <span className="inline-flex items-center gap-2 rounded-full bg-danger-tint px-3 py-1 text-sm font-medium text-recording"><span className="size-2 rounded-full bg-recording" />Recording</span>}
            {paused && <span className="rounded-full bg-tint px-3 py-1 text-sm font-medium">Paused</span>}
          </div>
          {active && <Wave live={recording} />}
          {voiceError && <div className="w-full"><ErrorNote message={voiceError} action={canRetry ? "Try again" : undefined} onAction={flow.retryTranscription} /></div>}

          {phase === "ready" && (
            <div className="mt-2 flex flex-col items-center gap-3">
              <button type="button" onClick={() => void flow.start()} aria-label="Start recording" className="flex size-24 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-8 ring-tint active:scale-95">
                <Mic className="size-10" />
              </button>
              <span className="font-medium">Record</span>
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-primary hover:bg-tint">
                <Upload className="size-[18px]" /> Upload an audio file
                <input type="file" hidden accept="audio/*,.mp3,.wav,.m4a,.mp4,.webm,.ogg,.opus,.flac" onChange={e => { const f = e.target.files?.[0]; if (f) void flow.uploadFile(f); e.currentTarget.value = ""; }} />
              </label>
            </div>
          )}
          {active && (
            <div className="mt-2 flex items-center justify-center gap-6">
              <button type="button" onClick={recording ? flow.pause : flow.resume} aria-label={recording ? "Pause recording" : "Resume recording"} className="flex size-14 items-center justify-center rounded-full border border-border bg-card">
                {recording ? <Pause /> : <Play />}
              </button>
              <button type="button" onClick={() => void flow.stop()} aria-label="Stop and transcribe" className="flex size-20 items-center justify-center rounded-full bg-recording text-white shadow-lg active:scale-95 dark:text-[#0b1421]">
                <Square className="size-8 fill-current" />
              </button>
              <button type="button" aria-label="Discard recording" onClick={async () => { if (await confirm({ title: "Discard this recording?", description: "The audio is deleted and cannot be recovered.", confirmLabel: "Discard", tone: "danger" })) flow.discard(); }} className="flex size-14 items-center justify-center rounded-full border border-border bg-card text-danger">
                <Trash2 />
              </button>
            </div>
          )}
        </div>
      )}

      {!active && (
        <section className="mt-2">
          {!typing ? (
            <button type="button" onClick={() => setTyping(true)} className="inline-flex min-h-11 items-center gap-2 text-primary underline-offset-4 hover:underline"><Pencil className="size-4" /> Type or paste a dictation instead</button>
          ) : (
            <div className="space-y-3 rounded-xl border border-border bg-card p-4">
              <TextAreaField label="What was said" rows={6} value={text} onChange={e => setText(e.target.value)}
                hint="For example: Carprofen 50 mg one tablet twice daily for five days. Medicines are matched to your catalogue and drafted for review." />
              <Button disabled={!text.trim()} onClick={() => void flow.submitTyped(text)}>Draft from text</Button>
            </div>
          )}
        </section>
      )}

      {!active && (
        <ActionBar>
          <Button variant="secondary" size="lg" onClick={() => { flow.setPhase("notes"); }}>Write notes by hand</Button>
        </ActionBar>
      )}
    </div>
  );
}
