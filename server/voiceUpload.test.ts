import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_AUDIO_BYTES } from "../shared/voice";
import { createVoiceRouter } from "./voiceUpload";

const realFetch = globalThis.fetch;
const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);
let server: Server;
let base: string;
let groq: ReturnType<typeof vi.fn>;
let clock = 0;

beforeEach(async () => {
  clock = 0;
  vi.stubEnv("GROQ_API_KEY", "groq-test-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
  const app = express();
  app.use(createVoiceRouter({ now: () => clock }));
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  groq = vi.fn(async () => new Response(JSON.stringify({ id: "req_1", text: " Bruno has vomited since yesterday. ", language: "en" })));
  // Only the Groq call is mocked; requests to the local test server go through.
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).startsWith(base) ? realFetch(input, init) : groq(input, init)
  );
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await new Promise(resolve => server.close(resolve));
});

const post = (body: BodyInit | null, type = "audio/webm;codecs=opus") =>
  realFetch(`${base}/api/voice/transcribe`, { method: "POST", headers: { "Content-Type": type }, body });

describe("POST /api/voice/transcribe (Groq mocked)", () => {
  it("forwards the uploaded audio to Groq and returns the trimmed transcript", async () => {
    const res = await post(webm);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ transcript: "Bruno has vomited since yesterday.", language: "en", requestId: "req_1" });

    const [url, init] = groq.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(init.headers).toEqual({ Authorization: "Bearer groq-test-key" });
    const file = init.body.get("file") as File;
    expect(file.name).toBe("consultation.webm");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(webm);
  });

  it("rejects an empty body", async () => {
    const res = await post(new Uint8Array(0));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("EMPTY_AUDIO");
    expect(groq).not.toHaveBeenCalled();
  });

  it("rejects non-audio content types and non-audio bytes", async () => {
    const wrongType = await post("hello", "text/plain");
    expect(wrongType.status).toBe(415);
    const wrongBytes = await post(new TextEncoder().encode("not really audio"), "audio/mpeg");
    expect(wrongBytes.status).toBe(415);
    expect(groq).not.toHaveBeenCalled();
  });

  it("rejects audio over the size limit without calling Groq", async () => {
    const res = await post(new Uint8Array(MAX_AUDIO_BYTES + 1));
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("FILE_TOO_LARGE");
    expect(groq).not.toHaveBeenCalled();
  });

  it("returns NO_SPEECH when Groq transcribes silence", async () => {
    groq.mockResolvedValueOnce(new Response(JSON.stringify({ text: "  " })));
    const res = await post(webm);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("NO_SPEECH");
  });

  it("maps Groq failures to safe messages that never include the key or upstream body", async () => {
    groq.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Invalid API Key groq-test-key" } }), { status: 401 }));
    const unauthorised = await post(webm);
    expect(unauthorised.status).toBe(503);
    expect(await unauthorised.text()).not.toContain("groq-test-key");

    groq.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    expect((await post(webm)).status).toBe(502);

    groq.mockResolvedValueOnce(new Response("{}", { status: 429 }));
    expect((await post(webm)).status).toBe(429);
  });

  it("reports a missing server key without calling Groq", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    const res = await post(webm);
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("NOT_CONFIGURED");
    expect(groq).not.toHaveBeenCalled();
  });

  it("rate limits repeated requests from one client", async () => {
    for (let i = 0; i < 12; i++) expect((await post(webm)).status).toBe(200);
    expect((await post(webm)).status).toBe(429);
    clock += 61_000;
    expect((await post(webm)).status).toBe(200);
  });

  it("does not log audio or secrets on failure", async () => {
    groq.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    await post(webm);
    const logged = JSON.stringify((console.error as unknown as ReturnType<typeof vi.fn>).mock.calls);
    expect(logged).not.toContain("groq-test-key");
  });
});
