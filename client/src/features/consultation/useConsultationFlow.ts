import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/api/client";
import { useAuth } from "@/features/auth/AuthProvider";
import { useApprovePrescription, useSavePrescription, type Prescription } from "@/features/prescriptions/api";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { extractConsultationDetails } from "@/lib/extraction";
import { transcribeAudioBlob, validateAudio, VoiceError } from "@/lib/voice";
import { completeConsultation, saveNotes, saveTranscript, structureText, type Consultation } from "./api";
import {
  emptyLine, fromDraft, fromSaved, initialPhase, linesNeedingAttention, notesFromConsultation, notesFromExtraction, notesToPatch, toInput,
  type Line, type NotesDraft, type Phase,
} from "./logic";

export type DraftStatus = "idle" | "running" | "done" | "failed";

/**
 * All the state and behaviour of one consultation: recording, transcribing, drafting, notes, the
 * prescription and its approval. The screens only read this and call its actions. Everything that
 * matters is saved to the server as it happens, so closing the tab loses nothing, and the
 * consultation reopens where it was left.
 */
export function useConsultationFlow(consultation: Consultation, existingRx: Prescription | null) {
  const { features, can } = useAuth();
  const qc = useQueryClient();
  const recorder = useAudioRecorder();
  const savePrescription = useSavePrescription();
  const approvePrescription = useApprovePrescription();

  const [phase, setPhase] = useState<Phase>(() => initialPhase(consultation, existingRx));
  const [elapsed, setElapsed] = useState(0);
  const [voiceError, setVoiceError] = useState("");
  const [canRetry, setCanRetry] = useState(false);
  const [transcript, setTranscript] = useState(() => consultation.transcripts.at(-1)?.text ?? "");
  const [draftStatus, setDraftStatus] = useState<DraftStatus>(consultation.transcripts.length ? "done" : "idle");
  const [draftError, setDraftError] = useState("");
  const [notes, setNotes] = useState<NotesDraft>(() => notesFromConsultation(consultation));
  const [lines, setLines] = useState<Line[]>(() => existingRx?.lines.map(fromSaved) ?? []);
  const [prescriptionId, setPrescriptionId] = useState<string | undefined>(existingRx?.id ?? consultation.prescriptions[0]?.id);
  const [source, setSource] = useState<"manual" | "voice">(consultation.source);
  const [saving, setSaving] = useState(false);
  const audio = useRef<Blob | File | null>(null);

  const voiceOn = features.voice;
  const canTranscribe = features.voice && features.transcriptionAvailable;

  // The clock runs only while recording.
  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Leaving mid-recording would lose the audio, so the browser asks first.
  useEffect(() => {
    if (phase !== "recording" && phase !== "paused") return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [phase]);

  const refreshConsultation = useCallback(() => { void qc.invalidateQueries({ queryKey: ["consultation"] }); }, [qc]);

  // ---- speech to text, then notes and lines ----

  /** Text in hand (spoken or typed): keep it, then draft notes and prescription lines from it. */
  const processTranscript = useCallback(async (text: string, language: string, provider: string) => {
    setTranscript(text);
    setPhase("drafting");
    setDraftStatus("running");
    setDraftError("");
    try {
      // The transcript is stored first, so a failed draft never loses what was said.
      await saveTranscript(consultation.id, { language, provider, text });
      if (features.extractionAvailable) {
        const r = await extractConsultationDetails(text);
        const next = notesFromExtraction(r.notes, notes);
        setNotes(next);
        setLines(r.lines.map(fromDraft));
        await saveNotes(consultation.id, { ...notesToPatch(next), source: "voice" });
      } else {
        // No language model on this server: rules and catalogue matching draft the medicines. Notes are left for the vet.
        const r = await structureText(text);
        setLines(r.lines.map(fromDraft));
        await saveNotes(consultation.id, { source: "voice" });
      }
      setSource("voice");
      setDraftStatus("done");
      refreshConsultation();
    } catch (e) {
      setDraftStatus("failed");
      setDraftError(errorMessage(e, "Could not draft from this transcript."));
    }
    setPhase("drafted");
  }, [consultation.id, features.extractionAvailable, notes, refreshConsultation]);

  const transcribe = useCallback(async (blob: Blob | File) => {
    setVoiceError("");
    setCanRetry(false);
    setPhase("transcribing");
    try {
      const r = await transcribeAudioBlob(blob, { name: blob instanceof File ? blob.name : undefined });
      audio.current = null;
      await processTranscript(r.transcript, r.language ?? features.asrLanguage, "speech-to-text");
    } catch (e) {
      // The recording is kept so the vet can retry without speaking again.
      audio.current = blob;
      setVoiceError(e instanceof VoiceError ? e.message : errorMessage(e));
      setCanRetry(true);
      setPhase("ready");
    }
  }, [features.asrLanguage, processTranscript]);

  const start = useCallback(async () => {
    setVoiceError("");
    setCanRetry(false);
    audio.current = null;
    try {
      await recorder.start();
      setElapsed(0);
      setPhase("recording");
    } catch (e) {
      setVoiceError(e instanceof VoiceError ? e.message : errorMessage(e));
    }
  }, [recorder]);

  const pause = useCallback(() => { recorder.pause(); setPhase("paused"); }, [recorder]);
  const resume = useCallback(() => { recorder.resume(); setPhase("recording"); }, [recorder]);
  const stop = useCallback(async () => {
    try {
      const blob = await recorder.stop();
      await transcribe(blob);
    } catch (e) {
      setVoiceError(e instanceof VoiceError ? e.message : errorMessage(e));
      setPhase("ready");
    }
  }, [recorder, transcribe]);
  const discard = useCallback(() => { recorder.cancel(); audio.current = null; setElapsed(0); setVoiceError(""); setPhase("ready"); }, [recorder]);
  const retryTranscription = useCallback(() => { if (audio.current) void transcribe(audio.current); }, [transcribe]);

  const uploadFile = useCallback(async (file: File) => {
    try { validateAudio(file); } catch (e) { setVoiceError(e instanceof VoiceError ? e.message : errorMessage(e)); return; }
    setElapsed(0);
    await transcribe(file);
  }, [transcribe]);

  /** Typed or pasted dictation. Works with no microphone and no transcription service. */
  const submitTyped = useCallback(async (text: string) => { await processTranscript(text.trim(), "en", "typed"); }, [processTranscript]);
  const retryDraft = useCallback(() => { if (transcript) void processTranscript(transcript, features.asrLanguage, "retry"); }, [transcript, features.asrLanguage, processTranscript]);

  // ---- notes ----

  const updateNotes = useCallback((patch: Partial<NotesDraft>) => setNotes(n => ({ ...n, ...patch })), []);
  const persistNotes = useCallback(async () => {
    await saveNotes(consultation.id, notesToPatch(notes));
    refreshConsultation();
  }, [consultation.id, notes, refreshConsultation]);

  // ---- prescription ----

  const saveDraft = useCallback(async (): Promise<string | undefined> => {
    if (lines.length === 0) return prescriptionId;
    const rx = await savePrescription.mutateAsync({ id: prescriptionId, consultationId: consultation.id, source, lines: lines.map(toInput) });
    setPrescriptionId(rx.id);
    // Saved lines get server ids, which keeps later edits attached to the right rows.
    setLines(rx.lines.map(fromSaved).map((l, i) => ({ ...l, candidates: lines[i]?.candidates ?? [] })));
    return rx.id;
  }, [lines, prescriptionId, consultation.id, source, savePrescription]);

  /** Save the draft, approve it (vets only), and close the consultation. The server enforces every rule again. */
  const approve = useCallback(async () => {
    if (!can("prescription.approve")) throw new Error("Only a vet can approve a prescription.");
    setSaving(true);
    try {
      await persistNotes();
      const id = await saveDraft();
      if (!id) throw new Error("Add at least one medicine before approving.");
      await approvePrescription.mutateAsync(id);
      await completeConsultation(consultation.id);
      refreshConsultation();
      setPhase("done");
    } finally {
      setSaving(false);
    }
  }, [can, persistNotes, saveDraft, approvePrescription, consultation.id, refreshConsultation]);

  /** Closing the consultation with no prescription (for example a check-up with no medicine). */
  const finishWithoutPrescription = useCallback(async () => {
    setSaving(true);
    try { await persistNotes(); await completeConsultation(consultation.id); refreshConsultation(); setPhase("done"); }
    finally { setSaving(false); }
  }, [persistNotes, consultation.id, refreshConsultation]);

  const addBlankLine = useCallback(() => { const l = emptyLine(); setLines(ls => [...ls, l]); return l.key; }, []);

  return {
    consultation, phase, setPhase, elapsed, voiceOn, canTranscribe, voiceError, canRetry, transcript, draftStatus, draftError,
    notes, updateNotes, persistNotes, lines, setLines, addBlankLine, saving: saving || savePrescription.isPending || approvePrescription.isPending,
    prescriptionId, linesNeedingAttention: linesNeedingAttention(lines), canApprove: can("prescription.approve"),
    start, pause, resume, stop, discard, retryTranscription, uploadFile, submitTyped, retryDraft, saveDraft, approve, finishWithoutPrescription,
  };
}

export type ConsultationFlow = ReturnType<typeof useConsultationFlow>;
