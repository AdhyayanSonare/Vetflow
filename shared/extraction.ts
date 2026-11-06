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

export type ExtractionSuccess = { notes: ExtractedNotes; medicines: ExtractedMedicine[]; model: string };

export type ExtractionErrorCode = "INVALID_INPUT" | "RATE_LIMITED" | "NOT_CONFIGURED" | "SERVICE_ERROR";
export type ExtractionFailure = { error: { code: ExtractionErrorCode; message: string } };
