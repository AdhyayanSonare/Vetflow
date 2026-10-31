import type { Consultation, Medicine, Patient } from "./data";

/**
 * Frontend stand-in for the voice pipeline that lives on the backend
 * (voice-transcription branch: POST /api/voice/transcribe → Groq Whisper,
 * POST /api/consultation/extract → structured notes and medicines).
 *
 * The UI only depends on these three functions. Wiring the real endpoints
 * means replacing their bodies; nothing in the screens changes.
 */

export class PipelineError extends Error {}

const AUDIO_TYPES = ["audio/", "video/webm", "video/mp4"];
const MAX_AUDIO_MB = 25;

/** Same limits the backend enforces, so the vet gets the message before uploading. */
export function validateAudio(file: { name: string; type: string; size: number }) {
  if (file.size === 0) throw new PipelineError("That file is empty. Choose a recording that has sound.");
  if (file.size > MAX_AUDIO_MB * 1024 * 1024) throw new PipelineError(`That recording is over ${MAX_AUDIO_MB} MB. Upload a shorter one.`);
  const ok = AUDIO_TYPES.some((prefix) => file.type.startsWith(prefix)) || /\.(mp3|wav|m4a|mp4|webm|ogg|opus|flac)$/i.test(file.name);
  if (!ok) throw new PipelineError("Unsupported format. Use MP3, WAV, M4A, WebM, OGG or FLAC.");
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Demo transcript, phrased for whichever patient is being seen. */
export async function transcribe(patient: Patient): Promise<{ transcript: string }> {
  await wait(2200);
  const age = patient.age.replace(/ y$/, "-year-old").replace(/ years?$/, "-year-old");
  return {
    transcript: `${patient.name}, ${age} ${patient.breed}, ${patient.weight}. Owner says ${patient.gender === "Female" ? "she" : "he"} has been vomiting since yesterday and is off food. Temperature one hundred and two Fahrenheit, mildly dehydrated, abdomen a little tender. This looks like acute gastroenteritis. Start metronidazole two fifty, one tab twice a day for five days, ondansetron four milligrams, one tab twice a day for three days, and probiotic paste five grams once a day for a week. Bland diet, boiled rice and chicken, for three days. Recheck in five days.`,
  };
}

/** Demo extraction: only what the transcript states, like the real prompt. */
export async function extract(_transcript: string): Promise<{ notes: Consultation["notes"]; medicines: Medicine[] }> {
  await wait(2600);
  const stamp = Date.now();
  return {
    notes: {
      complaint: "Vomiting since yesterday; off food",
      duration: "Since yesterday",
      examination: "Temperature 102°F, mildly dehydrated, abdomen a little tender.",
      diagnosis: "Acute gastroenteritis",
      treatment: "Bland diet, boiled rice and chicken, for three days.",
      followUp: "Recheck in five days",
    },
    medicines: [
      { id: `med-${stamp}-1`, name: "Metronidazole", strength: "250 mg", dosage: "1 tab", route: "Oral", frequency: "BID", duration: "5 days", instructions: "" },
      { id: `med-${stamp}-2`, name: "Ondansetron", strength: "4 mg", dosage: "1 tab", route: "Oral", frequency: "BID", duration: "3 days", instructions: "" },
      { id: `med-${stamp}-3`, name: "Probiotic paste", strength: "", dosage: "5 g", route: "Oral", frequency: "SID", duration: "7 days", instructions: "" },
    ],
  };
}
