import express, { type Express, type NextFunction, type Request, type Response } from "express";
import {
  AUDIO_EXTENSION_MIME,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_MB,
  SUPPORTED_AUDIO_LABEL,
  VOICE_TRANSCRIBE_PATH,
  isAcceptedAudioMime,
  sniffAudioContainer,
  type VoiceErrorCode,
  type VoiceTranscribeFailure,
  type VoiceTranscribeSuccess,
} from "../shared/voice";
import { transcribeAudio } from "./_core/voiceTranscription";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 12;

function fail(res: Response, status: number, code: VoiceErrorCode, message: string) {
  const body: VoiceTranscribeFailure = { error: { code, message } };
  res.status(status).json(body);
}

/** Small in-memory per-client limiter: transcription spends API credit and handles patient audio. */
export function createRateLimiter(now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const t = now();
    const recent = (hits.get(key) ?? []).filter(time => t - time < RATE_LIMIT_WINDOW_MS);
    if (recent.length >= RATE_LIMIT_MAX) {
      hits.set(key, recent);
      return false;
    }
    recent.push(t);
    hits.set(key, recent);
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (v.every(time => t - time >= RATE_LIMIT_WINDOW_MS)) hits.delete(k);
    }
    return true;
  };
}

export function createVoiceRouter(options: { now?: () => number } = {}) {
  const router = express.Router();
  const allow = createRateLimiter(options.now);

  router.post(
    VOICE_TRANSCRIBE_PATH,
    (req: Request, res: Response, next: NextFunction) => {
      if (!allow(req.ip ?? "unknown")) {
        return fail(res, 429, "RATE_LIMITED", "Too many transcription requests. Please wait a minute and try again.");
      }
      const declared = Number(req.headers["content-length"]);
      if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES) {
        return fail(res, 413, "FILE_TOO_LARGE", `Audio is larger than the ${MAX_AUDIO_MB} MB limit.`);
      }
      if (!isAcceptedAudioMime(req.headers["content-type"])) {
        return fail(res, 415, "UNSUPPORTED_FORMAT", `Unsupported audio format. Use ${SUPPORTED_AUDIO_LABEL}.`);
      }
      next();
    },
    express.raw({ type: () => true, limit: MAX_AUDIO_BYTES }),
    async (req: Request, res: Response) => {
      const body: unknown = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        return fail(res, 400, "EMPTY_AUDIO", "No audio was received. Record or choose a file and try again.");
      }
      const container = sniffAudioContainer(body);
      if (!container) {
        return fail(res, 415, "UNSUPPORTED_FORMAT", `The file is not a supported audio recording. Use ${SUPPORTED_AUDIO_LABEL}.`);
      }

      // Name and type sent upstream come from the sniffed container, never from client-supplied values.
      const mime = AUDIO_EXTENSION_MIME[container];
      const result = await transcribeAudio({
        audioFile: new File([new Uint8Array(body)], `consultation.${container}`, { type: mime }),
      });

      if ("error" in result) {
        // Log only the failure class/status — never audio, keys or upstream payloads.
        console.error("[voice] transcription failed:", result.code, result.status ?? "");
        if (result.details === "GROQ_API_KEY is not set") {
          return fail(res, 503, "NOT_CONFIGURED", "Voice transcription is not configured on the server.");
        }
        if (result.status === 413) return fail(res, 413, "FILE_TOO_LARGE", `Audio is larger than the ${MAX_AUDIO_MB} MB limit.`);
        if (result.status === 429) return fail(res, 429, "RATE_LIMITED", "The transcription service is busy. Please try again shortly.");
        if (result.status === 400) return fail(res, 422, "UNSUPPORTED_FORMAT", "The transcription service could not read this audio. Try another recording or format.");
        if (result.status === 401 || result.status === 403) {
          return fail(res, 503, "NOT_CONFIGURED", "Voice transcription is not configured correctly on the server.");
        }
        return fail(res, 502, "SERVICE_ERROR", "Transcription failed. Please try again.");
      }

      const transcript = result.transcript.trim();
      if (!transcript) {
        return fail(res, 422, "NO_SPEECH", "No speech was detected in the audio. Check the microphone and try again.");
      }
      const ok: VoiceTranscribeSuccess = { transcript, language: result.language_code, requestId: result.request_id };
      res.set("Cache-Control", "no-store").json(ok);
    },
    // Body-parser errors (too large, aborted upload) as JSON rather than an HTML error page.
    (err: { type?: string; status?: number }, _req: Request, res: Response, _next: NextFunction) => {
      if (err?.type === "entity.too.large") {
        return fail(res, 413, "FILE_TOO_LARGE", `Audio is larger than the ${MAX_AUDIO_MB} MB limit.`);
      }
      console.error("[voice] upload failed:", err?.type ?? "unknown");
      fail(res, 400, "EMPTY_AUDIO", "The upload could not be read. Please try again.");
    }
  );
  return router;
}

export function registerVoiceRoutes(app: Express) {
  app.use(createVoiceRouter());
}
