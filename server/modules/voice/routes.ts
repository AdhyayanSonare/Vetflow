import express, { type Express, type Request, type Response } from "express";
import type pg from "pg";
import { z } from "zod";
import { EXTRACT_PATH, MAX_TRANSCRIPT_CHARS, type ExtractionSuccess } from "../../../shared/extraction";
import {
  MAX_AUDIO_BYTES, MAX_AUDIO_MB, SUPPORTED_AUDIO_LABEL, VOICE_TRANSCRIBE_PATH, isAcceptedAudioMime, sniffAudioContainer,
} from "../../../shared/voice";
import { withTenant } from "../../db/pool";
import { apiError } from "../../http/errors";
import { rateLimit } from "../../http/rateLimit";
import { route } from "../../http/route";
import { logger } from "../../logging/logger";
import { can, type Permission } from "../auth/permissions";
import type { AsrClient } from "./asr";
import type { Extractor } from "./extract";
import { matchMedicines, structureTranscript } from "./structure";

export type VoiceDeps = { asr: AsrClient | null; extractor: Extractor | null };

const LANGS = ["en", "de", "fr", "es", "hi"] as const;

/** Sign-in, role and the tenant's voice switch. Returns the tenant's default language, or null after sending the error. */
async function voiceGate(pool: pg.Pool, req: Request, res: Response, perm: Permission): Promise<string | null> {
  const user = req.user;
  if (!user) { apiError(res, 401, "unauthenticated", "Sign in to continue."); return null; }
  if (!can(user.role, perm)) { apiError(res, 403, "forbidden", "Your role does not allow this action."); return null; }
  const flags = await withTenant(user.tenantId, async c =>
    (await c.query("select voice_enabled, asr_default_language from tenant_settings")).rows[0], pool);
  if (!flags?.voice_enabled) { apiError(res, 403, "voice_disabled", "Voice is switched off for this account."); return null; }
  return flags.asr_default_language as string;
}

export function registerVoiceRoutes(app: Express, pool: pg.Pool, deps: VoiceDeps) {
  // One user can start a few clips a minute. Transcription is CPU or credit bound.
  const limit = rateLimit({ windowMs: 60_000, max: 12, message: "Too many recordings. Wait a minute and try again.", key: req => req.user?.userId ?? req.ip ?? "x" });

  app.post(VOICE_TRANSCRIBE_PATH, limit, express.raw({ type: () => true, limit: MAX_AUDIO_BYTES }), async (req, res, next) => {
    try {
      const defaultLanguage = await voiceGate(pool, req, res, "clinical.write");
      if (defaultLanguage === null) return;
      const language = z.enum(LANGS).catch(defaultLanguage as (typeof LANGS)[number]).parse(req.query.language ?? defaultLanguage);

      if (!isAcceptedAudioMime(req.headers["content-type"])) {
        return apiError(res, 415, "UNSUPPORTED_FORMAT", `Unsupported audio format. Use ${SUPPORTED_AUDIO_LABEL}.`);
      }
      const body: unknown = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) return apiError(res, 400, "EMPTY_AUDIO", "No audio was received. Record or choose a file and try again.");
      if (body.length > MAX_AUDIO_BYTES) return apiError(res, 413, "FILE_TOO_LARGE", `Audio is larger than the ${MAX_AUDIO_MB} MB limit.`);
      if (!sniffAudioContainer(body)) return apiError(res, 415, "UNSUPPORTED_FORMAT", `The file is not a supported audio recording. Use ${SUPPORTED_AUDIO_LABEL}.`);
      if (!deps.asr) return apiError(res, 503, "NOT_CONFIGURED", "Voice transcription is not set up on this server.");

      let out;
      try {
        out = await deps.asr(body, req.headers["content-type"] as string, language);
      } catch (e) {
        // Only the failure class is logged: never audio, keys or provider payloads.
        logger.warn({ status: (e as { status?: number }).status, name: (e as Error).name }, "transcription failed");
        const status = (e as { status?: number }).status;
        if (status === 429) return apiError(res, 429, "RATE_LIMITED", "The transcription service is busy. Try again shortly.");
        if (status === 401 || status === 403) return apiError(res, 503, "NOT_CONFIGURED", "Voice transcription is not set up correctly on this server.");
        return apiError(res, 502, "SERVICE_ERROR", "Transcription failed. Try again.");
      }
      const transcript = out.text.trim();
      if (!transcript) return apiError(res, 422, "NO_SPEECH", "No speech was detected. Check the microphone and try again.");
      // The audio buffer is dropped here. Only the text is returned. Saving it is a separate, explicit step.
      res.set("Cache-Control", "no-store").json({ transcript, segments: out.segments, confidence: out.confidence, provider: out.provider, language: out.language });
    } catch (e) { next(e); }
  });

  // Notes and prescription lines drafted by a language model, then matched to the catalogue. Nothing is saved.
  app.post(EXTRACT_PATH, limit, async (req, res, next) => {
    try {
      if ((await voiceGate(pool, req, res, "clinical.write")) === null) return;
      const parsed = z.object({ transcript: z.string().trim().min(1, "There is no transcript to extract from.").max(MAX_TRANSCRIPT_CHARS, "The transcript is too long to process in one go.") }).safeParse(req.body);
      if (!parsed.success) return apiError(res, 400, "INVALID_INPUT", parsed.error.issues[0].message);
      if (!deps.extractor) return apiError(res, 503, "NOT_CONFIGURED", "Extraction is not set up on this server. Fill the notes in by hand.");

      const result = await deps.extractor(parsed.data.transcript);
      if (!result.ok) {
        logger.warn({ code: result.code, status: result.status }, "extraction failed");
        return result.code === "RATE_LIMITED"
          ? apiError(res, 429, "RATE_LIMITED", "The language service is busy. Try again shortly.")
          : apiError(res, 502, "SERVICE_ERROR", "Could not extract details from the transcript. Retry, or fill the notes in by hand.");
      }
      const lines = await withTenant(req.user!.tenantId, c => matchMedicines(c, result.medicines), pool);
      const ok: ExtractionSuccess = { notes: result.notes, medicines: result.medicines, lines, model: result.model };
      res.set("Cache-Control", "no-store").json(ok);
    } catch (e) { next(e); }
  });

  // Draft lines from a transcript without a language model: rules plus catalogue matching.
  app.post("/api/voice/structure", route(pool, "clinical.write", async ({ c, req }) => {
    const { text } = z.object({ text: z.string().trim().min(1).max(20000) }).parse(req.body);
    return { ...(await structureTranscript(c, text)), saved: false };
  }));
}
