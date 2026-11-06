// Shared by the browser and the server for the transcript -> structured consultation step.

export const EXTRACT_PATH = "/api/consultation/extract";
export const MAX_TRANSCRIPT_CHARS = 30_000;

export type ExtractedNotes = {
  complaint: string;
  duration: string;
  examination: string;
  diagnosis: string;
  treatment: string;
  followUp: string;
};

export type ExtractedMedicine = {
  name: string;
  strength: string;
  dosage: string;
  route: string;
  frequency: string;
  duration: string;
  instructions: string;
};

/** A catalogue item that could match a drug named in a consultation. */
export type Candidate = { itemId: string; name: string; strength: string | null; unit: string; score: number };

/** One drafted prescription line. `unmatched` lines need the vet to choose a catalogue item or type the drug by hand. */
export type DraftLine = {
  drugText: string;
  itemId: string | null;
  itemName: string | null;
  matchScore: number | null;
  candidates: Candidate[];
  dose: string | null;
  route: string | null;
  frequency: string | null;
  duration: string | null;
  instructions: string | null;
  quantity: number | null;
  unmatched: boolean;
  reason: string | null;
};

export type ExtractionSuccess = { notes: ExtractedNotes; medicines: ExtractedMedicine[]; lines: DraftLine[]; model: string };

export type ExtractionErrorCode = "INVALID_INPUT" | "RATE_LIMITED" | "NOT_CONFIGURED" | "SERVICE_ERROR";
export type ExtractionFailure = { error: { code: ExtractionErrorCode; message: string } };
