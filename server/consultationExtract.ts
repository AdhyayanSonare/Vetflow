import express, { type Express, type Request, type Response } from "express";
import { EXTRACT_PATH, MAX_TRANSCRIPT_CHARS, type ExtractionFailure, type ExtractionSuccess, type ExtractionErrorCode } from "../shared/extraction";
import { extractConsultation } from "./_core/consultationExtraction";
import { createRateLimiter } from "./voiceUpload";

function fail(res: Response, status: number, code: ExtractionErrorCode, message: string) {
  const body: ExtractionFailure = { error: { code, message } };
  res.status(status).json(body);
}

export function createExtractionRouter(options: { now?: () => number } = {}) {
  const router = express.Router();
  const allow = createRateLimiter(options.now);

  router.post(EXTRACT_PATH, express.json({ limit: "200kb" }), async (req: Request, res: Response) => {
    if (!allow(req.ip ?? "unknown")) {
      return fail(res, 429, "RATE_LIMITED", "Too many requests. Please wait a minute and try again.");
    }
    const transcript: unknown = req.body?.transcript;
    if (typeof transcript !== "string" || !transcript.trim()) {
      return fail(res, 400, "INVALID_INPUT", "There is no transcript to extract from.");
    }
    if (transcript.length > MAX_TRANSCRIPT_CHARS) {
      return fail(res, 400, "INVALID_INPUT", "The transcript is too long to process in one go.");
    }

    const result = await extractConsultation(transcript.trim());
    if (!result.ok) {
      // Log only the failure class/status — never the transcript, key or model output.
      console.error("[extract] failed:", result.code, result.status ?? "");
      if (result.code === "NOT_CONFIGURED") return fail(res, 503, "NOT_CONFIGURED", "Extraction is not configured on the server.");
      if (result.code === "RATE_LIMITED") return fail(res, 429, "RATE_LIMITED", "The AI service is busy. Please try again shortly.");
      return fail(res, 502, "SERVICE_ERROR", "Could not extract details from the transcript. Please retry.");
    }
    const ok: ExtractionSuccess = { notes: result.notes, medicines: result.medicines, model: result.model };
    res.set("Cache-Control", "no-store").json(ok);
  });
  return router;
}

export function registerExtractionRoutes(app: Express) {
  app.use(createExtractionRouter());
}
