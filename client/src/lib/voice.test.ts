import { describe, expect, it, vi } from "vitest";
import { MAX_AUDIO_BYTES } from "@shared/voice";
import { VoiceError, describeMicError, pickRecorderMimeType, transcribeAudioBlob, validateAudio } from "./voice";

describe("validateAudio", () => {
  it("accepts supported types, ignoring codec parameters", () => {
    expect(validateAudio({ type: "audio/webm;codecs=opus", size: 10 })).toBe("audio/webm");
    expect(validateAudio({ type: "audio/mpeg", size: 10 })).toBe("audio/mpeg");
  });
  it("falls back to the extension when the browser gives no type", () => {
    expect(validateAudio({ name: "visit.M4A", type: "", size: 10 })).toBe("audio/mp4");
  });
  it("rejects empty, oversized and unsupported files with clear messages", () => {
    expect(() => validateAudio({ type: "audio/wav", size: 0 })).toThrow(/empty/);
    expect(() => validateAudio({ type: "audio/wav", size: MAX_AUDIO_BYTES + 1 })).toThrow(/25 MB/);
    expect(() => validateAudio({ name: "notes.pdf", type: "application/pdf", size: 5 })).toThrow(/Unsupported/);
  });
});

describe("transcribeAudioBlob", () => {
  const audio = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
  it("posts raw audio and returns the server transcript", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ transcript: "hello", language: "en", requestId: "r" })));
    await expect(transcribeAudioBlob(audio, { fetchImpl })).resolves.toEqual({ transcript: "hello", language: "en", requestId: "r" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/voice/transcribe");
    expect(init.body).toBe(audio);
    expect(init.headers).toEqual({ "Content-Type": "audio/webm" });
  });
  it("surfaces server error messages", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: "NO_SPEECH", message: "No speech was detected" } }), { status: 422 }));
    await expect(transcribeAudioBlob(audio, { fetchImpl })).rejects.toMatchObject({ code: "NO_SPEECH", message: "No speech was detected" });
  });
  it("turns network failures into a retryable message", async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    await expect(transcribeAudioBlob(audio, { fetchImpl })).rejects.toMatchObject({ code: "NETWORK" });
  });
  it("rejects an empty transcript response", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ transcript: " " })));
    await expect(transcribeAudioBlob(audio, { fetchImpl })).rejects.toBeInstanceOf(VoiceError);
  });
});

describe("recorder helpers", () => {
  it("maps microphone errors to actionable messages", () => {
    expect(describeMicError(Object.assign(new Error("x"), { name: "NotAllowedError" })).code).toBe("MIC_DENIED");
    expect(describeMicError(Object.assign(new Error("x"), { name: "NotFoundError" })).code).toBe("MIC_NOT_FOUND");
    expect(describeMicError(Object.assign(new Error("x"), { name: "NotReadableError" })).code).toBe("MIC_BUSY");
  });
  it("picks the first MIME type the browser supports", () => {
    expect(pickRecorderMimeType({ isTypeSupported: t => t === "audio/mp4" })).toBe("audio/mp4");
    expect(pickRecorderMimeType({ isTypeSupported: () => false })).toBeUndefined();
    expect(pickRecorderMimeType(undefined)).toBeUndefined();
  });
});
