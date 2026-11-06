import express, { type Express } from "express";
import type pg from "pg";
import { z } from "zod";
import {
  MAX_AUDIO_BYTES, MAX_AUDIO_MB, SUPPORTED_AUDIO_LABEL, VOICE_TRANSCRIBE_PATH, isAcceptedAudioMime, sniffAudioContainer,
} from "../../shared/voice";
import { can } from "../auth/permissions";
import { rateLimit } from "../auth/rateLimit";
import { withTenant } from "../db/pool";
import { apiError } from "../http";
import { structureTranscript } from "../voice/structure";
import { route } from "./helpers";

export type AsrResult = { text: string; segments: Array<{ start: number; end: number; text: string }>; confidence: number | null; provider: string; language: string };
export type AsrClient = (audio: Buffer, mime: string, language: string) => Promise<AsrResult>;

/** Calls the local asr container. Audio goes to that service only and is not stored here. */
export function httpAsrClient(baseUrl: string, timeoutMs = 60_000): AsrClient {
  return async (audio, mime, language) => {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/transcribe?language=${encodeURIComponent(language)}`, {
      method: "POST", headers: { "content-type": mime }, body: new Uint8Array(audio), signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw Object.assign(new Error(`asr ${res.status}`), { status: res.status });
    return (await res.json()) as AsrResult;
  };
}

const LANGS = ["en", "de", "fr", "es", "hi"] as const;

export function registerVoiceRoutes(app: Express, pool: pg.Pool, asr: AsrClient | null) {
  // One user can start a few clips a minute. The service is CPU-bound.
  const limit = rateLimit({ windowMs: 60_000, max: 12, message: "Too many recordings. Wait a minute and try again.", key: req => req.user?.userId ?? req.ip ?? "x" });

  app.post(VOICE_TRANSCRIBE_PATH, limit, express.raw({ type: () => true, limit: MAX_AUDIO_BYTES }), async (req, res, next) => {
    try {
      const user = req.user;
      if (!user) return apiError(res, 401, "unauthenticated", "Sign in to continue.");
      if (!can(user.role, "clinical.write")) return apiError(res, 403, "forbidden", "Your role does not allow this action.");
      const flags = await withTenant(user.tenantId, async c =>
        (await c.query("select voice_enabled, asr_default_language from tenant_settings")).rows[0], pool);
      if (!flags?.voice_enabled) return apiError(res, 403, "voice_disabled", "Voice is switched off for this account.");
      const language = z.enum(LANGS).catch(flags.asr_default_language).parse(req.query.language ?? flags.asr_default_language);

      if (!isAcceptedAudioMime(req.headers["content-type"])) {
        return apiError(res, 415, "UNSUPPORTED_FORMAT", `Unsupported audio format. Use ${SUPPORTED_AUDIO_LABEL}.`);
      }
      const body: unknown = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) return apiError(res, 400, "EMPTY_AUDIO", "No audio was received. Record or choose a file and try again.");
      if (body.length > MAX_AUDIO_BYTES) return apiError(res, 413, "FILE_TOO_LARGE", `Audio is larger than the ${MAX_AUDIO_MB} MB limit.`);
      const container = sniffAudioContainer(body);
      if (!container) return apiError(res, 415, "UNSUPPORTED_FORMAT", `The file is not a supported audio recording. Use ${SUPPORTED_AUDIO_LABEL}.`);
      if (!asr) return apiError(res, 503, "NOT_CONFIGURED", "Voice transcription is not set up on this server.");

      let out: AsrResult;
      try { out = await asr(body, req.headers["content-type"] as string, language); }
      catch (e) {
        console.error("[voice] asr failed:", (e as { status?: number }).status ?? (e as Error).name);
        return apiError(res, 502, "SERVICE_ERROR", "Transcription failed. Try again.");
      }
      const transcript = out.text.trim();
      if (!transcript) return apiError(res, 422, "NO_SPEECH", "No speech was detected. Check the microphone and try again.");
      // The audio buffer is dropped here. Only the text is returned. Saving it is a separate, explicit step.
      res.set("Cache-Control", "no-store").json({ transcript, segments: out.segments, confidence: out.confidence, provider: out.provider, language: out.language });
    } catch (e) { next(e); }
  });

  // Draft lines from a transcript. Nothing is saved: the vet reviews, edits and then creates the prescription.
  app.post("/api/voice/structure", route(pool, "clinical.write", async ({ c, req }) => {
    const { text } = z.object({ text: z.string().trim().min(1).max(20000) }).parse(req.body);
    const r = await structureTranscript(c, text);
    return { ...r, saved: false };
  }));
}
