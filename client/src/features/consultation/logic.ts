import type { Candidate, DraftLine, ExtractedNotes } from "@shared/extraction";
import type { LineInput, Prescription, PrescriptionLine } from "@/features/prescriptions/api";
import type { ConsultationSummary } from "@/features/patients/api";

/**
 * The rules of a consultation, as plain functions: how drafted text becomes prescription lines,
 * what is missing before approval, and where a half-finished consultation resumes. No React here,
 * so it is unit tested directly.
 */

export type Phase = "ready" | "recording" | "paused" | "transcribing" | "drafting" | "drafted" | "notes" | "prescription" | "done";

export type Line = {
  key: string;
  itemId: string | null;
  /** What to show for the medicine: the catalogue name when matched, otherwise what was heard or typed. */
  drugText: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
  instructions: string;
  quantity: string;
  candidates: Candidate[];
  reason: string | null;
};

let counter = 0;
export const newKey = () => `l${Date.now().toString(36)}${(counter++).toString(36)}`;

export const emptyLine = (): Line => ({ key: newKey(), itemId: null, drugText: "", dose: "", route: "Oral", frequency: "", duration: "", instructions: "", quantity: "", candidates: [], reason: null });

const label = (name: string, strength: string | null | undefined) => (strength ? `${name} ${strength}` : name);

/** A line from the drafter. A matched item shows its catalogue name and strength. */
export function fromDraft(d: DraftLine): Line {
  const matched = d.itemId ? d.candidates.find(c => c.itemId === d.itemId) : undefined;
  return {
    key: newKey(),
    itemId: d.itemId,
    drugText: matched ? label(matched.name, matched.strength) : d.itemName ?? d.drugText,
    dose: d.dose ?? "", route: d.route ?? "", frequency: d.frequency ?? "", duration: d.duration ?? "", instructions: d.instructions ?? "",
    quantity: d.quantity != null ? String(d.quantity) : "",
    candidates: d.candidates, reason: d.reason,
  };
}

export function fromSaved(l: PrescriptionLine): Line {
  return {
    key: l.id, itemId: l.itemId, drugText: l.drugText, dose: l.dose ?? "", route: l.route ?? "", frequency: l.frequency ?? "", duration: l.duration ?? "",
    instructions: l.instructions ?? "", quantity: l.quantity != null ? String(l.quantity) : "", candidates: [], reason: l.unmatched ? "Not matched to the catalogue." : null,
  };
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);

export function toInput(l: Line): LineInput {
  const q = Number(l.quantity);
  return {
    itemId: l.itemId, drugText: l.drugText.trim(), dose: orNull(l.dose), route: orNull(l.route), frequency: orNull(l.frequency),
    duration: orNull(l.duration), instructions: orNull(l.instructions), quantity: l.quantity.trim() && Number.isFinite(q) && q > 0 ? q : null,
  };
}

/** "1 tablet · twice daily · 5 days · oral", or a plain note when no dose was given. */
export function lineSummary(l: Pick<Line, "dose" | "frequency" | "duration" | "route">): string {
  return [l.dose, l.frequency, l.duration, l.route].map(s => s.trim()).filter(Boolean).join(" · ") || "Dose not stated";
}

/** What stops a line being approved. An empty list means it is ready. */
export function lineProblems(l: Line): string[] {
  const out: string[] = [];
  if (!l.drugText.trim()) out.push("Name the medicine.");
  else if (!l.itemId) out.push("Choose the matching catalogue item.");
  if (l.quantity.trim() && !(Number(l.quantity) > 0)) out.push("Quantity must be more than 0.");
  return out;
}

export const linesNeedingAttention = (lines: Line[]) => lines.filter(l => lineProblems(l).length > 0);

/** Split an allergy note into words worth checking: "Penicillin, sulfa drugs" gives penicillin and sulfa. */
const allergenWords = (allergies: string) =>
  allergies.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !["drug", "drugs", "none", "allergy", "allergic", "reaction", "known"].includes(w));

/** Lines whose medicine name contains a word from the patient's allergy note. A warning for the vet, never an automatic block. */
export function allergyConflicts(lines: Pick<Line, "key" | "drugText">[], allergies: string | null | undefined): Array<{ key: string; allergen: string }> {
  if (!allergies?.trim()) return [];
  const words = allergenWords(allergies);
  const out: Array<{ key: string; allergen: string }> = [];
  for (const l of lines) {
    const name = l.drugText.toLowerCase();
    const hit = words.find(w => name.includes(w) || (w.length >= 6 && name.includes(w.slice(0, 6))));
    if (hit) out.push({ key: l.key, allergen: hit });
  }
  return out;
}

// ---- Notes ----

export type NotesDraft = {
  complaint: string; durationText: string; temperatureF: string; examination: string; diagnosis: string; treatmentPlan: string; followUpNote: string;
};

export const emptyNotes = (): NotesDraft => ({ complaint: "", durationText: "", temperatureF: "", examination: "", diagnosis: "", treatmentPlan: "", followUpNote: "" });

export function notesFromConsultation(c: Partial<ConsultationSummary>): NotesDraft {
  return {
    complaint: c.complaint ?? "", durationText: c.durationText ?? "", temperatureF: c.temperatureF != null ? String(c.temperatureF) : "",
    examination: c.examination ?? "", diagnosis: c.diagnosis ?? "", treatmentPlan: c.treatmentPlan ?? "", followUpNote: c.followUpNote ?? "",
  };
}

/** Notes as drafted from speech. Anything not said stays empty: nothing is invented. */
export function notesFromExtraction(n: ExtractedNotes, current: NotesDraft = emptyNotes()): NotesDraft {
  const take = (drafted: string, existing: string) => (drafted.trim() ? drafted.trim() : existing);
  return {
    ...current,
    complaint: take(n.complaint, current.complaint), durationText: take(n.duration, current.durationText), examination: take(n.examination, current.examination),
    diagnosis: take(n.diagnosis, current.diagnosis), treatmentPlan: take(n.treatment, current.treatmentPlan), followUpNote: take(n.followUp, current.followUpNote),
  };
}

/** The server patch for a notes draft. Blank fields are left out so a save never wipes a stored value by accident. */
export function notesToPatch(n: NotesDraft) {
  const t = Number(n.temperatureF);
  const s = (v: string) => (v.trim() ? v.trim() : undefined);
  return {
    complaint: s(n.complaint), durationText: s(n.durationText), examination: s(n.examination), diagnosis: s(n.diagnosis),
    treatmentPlan: s(n.treatmentPlan), followUpNote: s(n.followUpNote),
    temperatureF: n.temperatureF.trim() && Number.isFinite(t) && t >= 85 && t <= 115 ? t : undefined,
  };
}

export const isStated = (value: string) => value.trim().length > 0;

/** Where a consultation opens: wherever it was left. */
export function initialPhase(c: Pick<ConsultationSummary, "status"> & { transcripts?: unknown[] } & Partial<ConsultationSummary>, rx?: Pick<Prescription, "status"> | null): Phase {
  if (c.status === "completed" || rx?.status === "approved") return "done";
  if (rx) return "prescription";
  const noted = [c.complaint, c.durationText, c.examination, c.diagnosis, c.treatmentPlan, c.followUpNote].some(v => !!v?.trim());
  if ((c.transcripts?.length ?? 0) > 0 || noted) return "notes";
  return "ready";
}

export const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
