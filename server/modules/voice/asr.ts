import type { Config } from "../../config/env";

/**
 * Speech to text. A provider is a function from audio bytes to text. Which one runs is chosen by
 * configuration: Groq Whisper (hosted API) when GROQ_API_KEY is set, otherwise the local asr
 * container when ASR_URL is set, otherwise voice transcription is reported as not set up.
 */
export type AsrSegment = { start: number; end: number; text: string };
export type AsrResult = { text: string; segments: AsrSegment[]; confidence: number | null; provider: string; language: string };
export type AsrClient = (audio: Buffer, mime: string, language: string) => Promise<AsrResult>;

export class AsrError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "AsrError";
  }
}

const EXTENSION: Record<string, string> = {
  "audio/webm": "webm", "video/webm": "webm", "audio/ogg": "ogg", "audio/wav": "wav", "audio/wave": "wav", "audio/x-wav": "wav",
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "video/mp4": "mp4", "audio/m4a": "m4a", "audio/flac": "flac",
};

/** The local asr container. Audio goes to that service only and is not stored. */
export function localAsrClient(baseUrl: string, fetchImpl: typeof fetch = fetch, timeoutMs = 60_000): AsrClient {
  return async (audio, mime, language) => {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/transcribe?language=${encodeURIComponent(language)}`, {
      method: "POST", headers: { "content-type": mime }, body: new Uint8Array(audio), signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new AsrError(`asr ${res.status}`, res.status);
    return (await res.json()) as AsrResult;
  };
}

/** Groq's hosted Whisper. The API key stays on the server. Patient audio leaves the building, so this is an explicit choice. */
export function groqAsrClient(cfg: Config["groq"], fetchImpl: typeof fetch = fetch, timeoutMs = 120_000): AsrClient {
  return async (audio, mime, language) => {
    const base = mime.split(";")[0].trim().toLowerCase();
    const form = new FormData();
    form.append("model", cfg.transcribeModel);
    form.append("temperature", "0");
    form.append("response_format", "verbose_json");
    form.append("language", language);
    form.append("file", new File([new Uint8Array(audio)], `consultation.${EXTENSION[base] ?? "wav"}`, { type: base }));
    const res = await fetchImpl(`${cfg.apiUrl}/audio/transcriptions`, {
      method: "POST", headers: { Authorization: `Bearer ${cfg.apiKey}` }, body: form, signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json().catch(() => null)) as { text?: unknown; language?: unknown; segments?: Array<{ start: number; end: number; text: string }> } | null;
    if (!res.ok) throw new AsrError(`groq ${res.status}`, res.status);
    if (!body || typeof body.text !== "string") throw new AsrError("groq returned an unexpected response");
    return {
      text: body.text,
      segments: (body.segments ?? []).map(s => ({ start: s.start, end: s.end, text: s.text.trim() })),
      confidence: null,
      provider: "groq-whisper",
      language: typeof body.language === "string" ? body.language : language,
    };
  };
}

export function createAsrClient(config: Config, fetchImpl: typeof fetch = fetch): AsrClient | null {
  if (config.asr.kind === "groq") return groqAsrClient(config.groq, fetchImpl);
  if (config.asr.kind === "local" && config.asr.localUrl) return localAsrClient(config.asr.localUrl, fetchImpl);
  return null;
}
