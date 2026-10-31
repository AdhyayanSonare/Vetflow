/**
 * Voice transcription helper using Groq's Whisper API.
 *
 * Frontend implementation guide:
 * 1. Capture audio via MediaRecorder or upload a file
 * 2. POST the raw audio bytes to `/api/voice/transcribe` (see server/voiceUpload.ts)
 * 3. Receive the transcript; GROQ_API_KEY never leaves the server
 */
import { ENV } from "./env";

export type TranscribeOptions = {
  audioFile: Blob | File;
  fileName?: string;
  language?: string;
  prompt?: string;
  model?: string;
};

export type TranscriptionResponse = {
  request_id: string;
  transcript: string;
  language_code: string | null;
};

export type TranscriptionError = {
  error: string;
  code: "FILE_TOO_LARGE" | "INVALID_FORMAT" | "TRANSCRIPTION_FAILED" | "UPLOAD_FAILED" | "SERVICE_ERROR";
  details?: string;
  /** HTTP status returned by Groq, when the failure came from the upstream API. */
  status?: number;
};

function getLanguageName(langCode: string): string {
  const langMap: Record<string, string> = {
    en: "English",
    es: "Spanish",
    fr: "French",
    de: "German",
    it: "Italian",
    pt: "Portuguese",
    ru: "Russian",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese",
    ar: "Arabic",
    hi: "Hindi",
    nl: "Dutch",
    pl: "Polish",
    tr: "Turkish",
    sv: "Swedish",
    da: "Danish",
    no: "Norwegian",
    fi: "Finnish",
  };

  return langMap[langCode] ?? langCode;
}

async function buildGroqFormData(options: TranscribeOptions): Promise<FormData> {
  const formData = new FormData();
  formData.append("model", options.model ?? "whisper-large-v3");
  formData.append("temperature", "0");
  formData.append("response_format", "verbose_json");
  if (options.language) formData.append("language", options.language);
  if (options.prompt) formData.append("prompt", options.prompt);

  const file =
    options.audioFile instanceof File
      ? options.audioFile
      : new File([options.audioFile], options.fileName ?? "audio.wav", {
          type: options.audioFile.type || "audio/wav",
        });

  formData.append("file", file, file.name || "audio.wav");
  return formData;
}

export async function transcribeAudio(
  options: TranscribeOptions
): Promise<TranscriptionResponse | TranscriptionError> {
  const apiKey = ENV.groqApiKey;
  if (!apiKey) {
    return {
      error: "Voice transcription service is not configured",
      code: "SERVICE_ERROR",
      details: "GROQ_API_KEY is not set",
    };
  }

  try {
    const formData = await buildGroqFormData(options);
    const response = await fetch(`${ENV.groqApiUrl.replace(/\/$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
      signal: AbortSignal.timeout(120_000),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMessage =
        payload && typeof payload === "object" && "error" in payload
          ? JSON.stringify((payload as { error?: { message?: unknown } }).error)
          : "";

      return {
        error: "Transcription service request failed",
        code: "TRANSCRIPTION_FAILED",
        status: response.status,
        details: `${response.status} ${response.statusText}${errorMessage ? `: ${errorMessage}` : ""}`,
      };
    }

    if (!payload || typeof payload.text !== "string") {
      return {
        error: "Invalid transcription response",
        code: "SERVICE_ERROR",
        details: "Transcription service returned an invalid response format",
      };
    }

    return {
      request_id: typeof payload.id === "string" ? payload.id : "",
      transcript: payload.text,
      language_code:
        typeof payload.language === "string" || payload.language === null
          ? payload.language
          : null,
    };
  } catch (error) {
    return {
      error: "Voice transcription failed",
      code: "SERVICE_ERROR",
      details: error instanceof Error ? error.message : "An unexpected error occurred",
    };
  }
}
