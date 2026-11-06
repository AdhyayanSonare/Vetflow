import { describe, expect, it, vi } from "vitest";
import { AsrError, createAsrClient, groqAsrClient, localAsrClient } from "../../server/modules/voice/asr";
import { loadConfig } from "../../server/config/env";

const wav = Buffer.from("RIFF....WAVEfmt ");
const groq = { apiKey: "k-secret", apiUrl: "https://api.groq.com/openai/v1", transcribeModel: "whisper-large-v3", extractionModel: "m" };

describe("Groq transcription client", () => {
  it("posts the audio as multipart with the model and language, and maps the response", async () => {
    const fake = vi.fn(async (_u: unknown, _i?: unknown) => new Response(JSON.stringify({ text: " give carprofen ", language: "english", segments: [{ start: 0, end: 2, text: " give carprofen " }] }), { status: 200 }));
    const out = await groqAsrClient(groq, fake as unknown as typeof fetch)(wav, "audio/webm;codecs=opus", "en");
    expect(out).toMatchObject({ text: " give carprofen ", provider: "groq-whisper", language: "english", segments: [{ start: 0, end: 2, text: "give carprofen" }] });
    const [url, init] = fake.mock.calls[0] as [string, { headers: Record<string, string>; body: FormData }];
    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(init.headers.Authorization).toBe("Bearer k-secret");
    expect(init.body.get("model")).toBe("whisper-large-v3");
    expect(init.body.get("language")).toBe("en");
    const file = init.body.get("file") as File;
    expect(file.name).toBe("consultation.webm");
    expect(file.type).toBe("audio/webm");
  });

  it("turns provider failures into AsrError with the status, and never includes the key", async () => {
    const fake = vi.fn(async () => new Response(JSON.stringify({ error: { message: "bad key k-secret" } }), { status: 401 }));
    const err = await groqAsrClient(groq, fake as unknown as typeof fetch)(wav, "audio/wav", "en").catch(e => e);
    expect(err).toBeInstanceOf(AsrError);
    expect(err.status).toBe(401);
    expect(err.message).not.toContain("k-secret");
    const odd = vi.fn(async () => new Response(JSON.stringify({ nope: 1 }), { status: 200 }));
    await expect(groqAsrClient(groq, odd as unknown as typeof fetch)(wav, "audio/wav", "en")).rejects.toThrow(/unexpected response/);
  });
});

describe("local asr client", () => {
  it("posts raw bytes with the content type and language", async () => {
    const fake = vi.fn(async (_u: unknown, _i?: unknown) => new Response(JSON.stringify({ text: "hi", segments: [], confidence: null, provider: "canary", language: "en" })));
    const out = await localAsrClient("http://asr:8000/", fake as unknown as typeof fetch)(wav, "audio/wav", "de");
    expect(out.provider).toBe("canary");
    const [url, init] = fake.mock.calls[0] as [string, { headers: Record<string, string>; method: string }];
    expect(url).toBe("http://asr:8000/transcribe?language=de");
    expect(init).toMatchObject({ method: "POST", headers: { "content-type": "audio/wav" } });
  });
  it("reports the service status on failure", async () => {
    const fake = vi.fn(async () => new Response("no", { status: 501 }));
    await expect(localAsrClient("http://asr:8000", fake as unknown as typeof fetch)(wav, "audio/wav", "hi")).rejects.toMatchObject({ status: 501 });
  });
});

describe("provider choice", () => {
  it("Groq wins when both are set, local is used alone, and nothing is set means no provider", () => {
    expect(createAsrClient(loadConfig({ GROQ_API_KEY: "k", ASR_URL: "http://asr:8000" }))).toBeTypeOf("function");
    expect(createAsrClient(loadConfig({ ASR_URL: "http://asr:8000" }))).toBeTypeOf("function");
    expect(createAsrClient(loadConfig({}))).toBeNull();
  });
});
