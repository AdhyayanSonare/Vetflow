import {
  AUDIO_EXTENSION_MIME,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_MB,
  SUPPORTED_AUDIO_LABEL,
  VOICE_TRANSCRIBE_PATH,
  baseMimeType,
  extensionOf,
  isAcceptedAudioMime,
  type VoiceTranscribeFailure,
  type VoiceTranscribeSuccess,
} from "@shared/voice";

export class VoiceError extends Error {
  constructor(message: string, readonly code: string = "VOICE_ERROR") {
    super(message);
    this.name = "VoiceError";
  }
}

/** Returns the Content-Type to upload with, or throws a user-facing VoiceError. */
export function validateAudio(file: { name?: string; type: string; size: number }): string {
  if (file.size === 0) throw new VoiceError("The audio file is empty. Choose a recording that has sound.", "EMPTY_AUDIO");
  if (file.size > MAX_AUDIO_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    throw new VoiceError(`This audio is ${mb} MB. The limit is ${MAX_AUDIO_MB} MB — trim it or upload a shorter recording.`, "FILE_TOO_LARGE");
  }
  if (isAcceptedAudioMime(file.type)) return baseMimeType(file.type);
  // Some browsers leave `type` blank for .m4a/.flac/.opus; fall back to the extension.
  const byExtension = !file.type && file.name ? AUDIO_EXTENSION_MIME[extensionOf(file.name)] : undefined;
  if (byExtension) return byExtension;
  throw new VoiceError(`Unsupported audio format. Use ${SUPPORTED_AUDIO_LABEL}.`, "UNSUPPORTED_FORMAT");
}

export async function transcribeAudioBlob(
  audio: Blob,
  options: { name?: string; signal?: AbortSignal; fetchImpl?: typeof fetch } = {}
): Promise<VoiceTranscribeSuccess> {
  const contentType = validateAudio({ name: options.name, type: audio.type, size: audio.size });
  const doFetch = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(VOICE_TRANSCRIBE_PATH, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: audio,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new VoiceError("Could not reach the server. Check your connection and retry — your recording is kept.", "NETWORK");
  }

  const payload = (await response.json().catch(() => null)) as Partial<VoiceTranscribeSuccess & VoiceTranscribeFailure> | null;
  if (!response.ok) {
    throw new VoiceError(payload?.error?.message ?? `Transcription failed (${response.status}). Please retry.`, payload?.error?.code ?? "SERVICE_ERROR");
  }
  if (!payload || typeof payload.transcript !== "string" || !payload.transcript.trim()) {
    throw new VoiceError("The server returned no transcript. Please retry.", "SERVICE_ERROR");
  }
  return { transcript: payload.transcript, language: payload.language ?? null, requestId: payload.requestId ?? "" };
}

export function describeMicError(error: unknown): VoiceError {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return new VoiceError("Microphone access was blocked. Allow the microphone for this site in your browser settings, then try again.", "MIC_DENIED");
    case "NotFoundError":
    case "OverconstrainedError":
      return new VoiceError("No microphone was found. Connect one and try again.", "MIC_NOT_FOUND");
    case "NotReadableError":
    case "AbortError":
      return new VoiceError("The microphone is in use by another app or unavailable. Close other apps using it and try again.", "MIC_BUSY");
    default:
      return new VoiceError("Could not start recording. Please try again.", "RECORDER_ERROR");
  }
}

const RECORDER_MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

export function pickRecorderMimeType(recorder: { isTypeSupported(type: string): boolean } | undefined): string | undefined {
  return recorder ? RECORDER_MIME_CANDIDATES.find(type => recorder.isTypeSupported(type)) : undefined;
}
