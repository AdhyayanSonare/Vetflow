// Shared by the browser (pre-flight validation) and the server (authoritative validation).

/** Groq's per-request audio upload limit (free tier). */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const MAX_AUDIO_MB = 25;

export const VOICE_TRANSCRIBE_PATH = "/api/voice/transcribe";

/** Containers Groq Whisper accepts, keyed by the file extension we send upstream. */
export const AUDIO_EXTENSION_MIME: Record<string, string> = {
  flac: "audio/flac",
  mp3: "audio/mpeg",
  mpga: "audio/mpeg",
  mpeg: "audio/mpeg",
  mp4: "audio/mp4",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  webm: "audio/webm",
};

const ACCEPTED_MIME = new Set([
  "audio/flac",
  "audio/x-flac",
  "audio/mpeg",
  "audio/mp3",
  "audio/mpga",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/ogg",
  "audio/opus",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/vnd.wave",
  "audio/webm",
  // Some browsers/OSes label audio-only webm/mp4 containers as video.
  "video/webm",
  "video/mp4",
]);

export const SUPPORTED_AUDIO_LABEL = "MP3, WAV, M4A, MP4, WebM, OGG, FLAC";

/** Lower-cases a Content-Type and drops parameters such as `;codecs=opus`. */
export function baseMimeType(contentType: string | undefined | null): string {
  return (contentType ?? "").split(";")[0].trim().toLowerCase();
}

export function isAcceptedAudioMime(contentType: string | undefined | null): boolean {
  return ACCEPTED_MIME.has(baseMimeType(contentType));
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot + 1).toLowerCase();
}

export type AudioContainer = "webm" | "ogg" | "wav" | "flac" | "mp3" | "mp4";

/** Identifies the audio container from its leading bytes; null when unrecognised. */
export function sniffAudioContainer(bytes: Uint8Array): AudioContainer | null {
  const ascii = (start: number, text: string) =>
    bytes.length >= start + text.length && [...text].every((ch, i) => bytes[start + i] === ch.charCodeAt(0));
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "webm";
  if (ascii(0, "OggS")) return "ogg";
  if (ascii(0, "RIFF") && ascii(8, "WAVE")) return "wav";
  if (ascii(0, "fLaC")) return "flac";
  if (ascii(4, "ftyp")) return "mp4";
  if (ascii(0, "ID3")) return "mp3";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "mp3";
  return null;
}

export type VoiceErrorCode =
  | "EMPTY_AUDIO"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FORMAT"
  | "NO_SPEECH"
  | "RATE_LIMITED"
  | "NOT_CONFIGURED"
  | "SERVICE_ERROR";

export type VoiceTranscribeSuccess = {
  transcript: string;
  language: string | null;
  requestId: string;
};

export type VoiceTranscribeFailure = {
  error: { code: VoiceErrorCode; message: string };
};
