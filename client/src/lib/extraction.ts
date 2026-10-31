import { EXTRACT_PATH, type ExtractionFailure, type ExtractionSuccess } from "@shared/extraction";
import { VoiceError } from "./voice";

export async function extractConsultationDetails(
  transcript: string,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {}
): Promise<ExtractionSuccess> {
  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(EXTRACT_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript }),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new VoiceError("Could not reach the server to extract details. Retry, or fill the notes in manually.", "NETWORK");
  }
  const payload = (await response.json().catch(() => null)) as Partial<ExtractionSuccess & ExtractionFailure> | null;
  if (!response.ok) {
    throw new VoiceError(payload?.error?.message ?? `Extraction failed (${response.status}). Retry, or fill the notes in manually.`, payload?.error?.code ?? "SERVICE_ERROR");
  }
  if (!payload?.notes || !Array.isArray(payload.medicines)) {
    throw new VoiceError("The server returned an unexpected response. Retry, or fill the notes in manually.", "SERVICE_ERROR");
  }
  return { notes: payload.notes, medicines: payload.medicines, model: payload.model ?? "" };
}
