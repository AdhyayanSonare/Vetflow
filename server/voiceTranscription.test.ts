import { afterEach, describe, expect, it, vi } from "vitest";
import { transcribeAudio } from "./_core/voiceTranscription";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Groq voice transcription", () => {
  it("sends audio to Whisper and normalizes its verbose response", async () => {
    vi.stubEnv("GROQ_API_KEY", "groq-test-key");
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: "Hello there", language: "english" })));
    vi.stubGlobal("fetch", request);

    await expect(
      transcribeAudio({ audioFile: new File([new Uint8Array([1, 2, 3])], "a.m4a", { type: "audio/mp4" }) })
    ).resolves.toEqual({
      request_id: "",
      transcript: "Hello there",
      language_code: "english",
    });

    const [url, options] = request.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(options.headers).toEqual({ Authorization: "Bearer groq-test-key" });
    expect(options.body.get("model")).toBe("whisper-large-v3");
    expect(options.body.get("temperature")).toBe("0");
    expect(options.body.get("response_format")).toBe("verbose_json");
    expect(options.body.get("file")).toBeInstanceOf(File);
  });

  it("reports a missing Groq key without making a request", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);

    await expect(transcribeAudio({ audioFile: new Blob([new Uint8Array([1])]) })).resolves.toMatchObject({
      error: "Voice transcription service is not configured",
      details: "GROQ_API_KEY is not set",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("reports the upstream status without echoing the API key", async () => {
    vi.stubEnv("GROQ_API_KEY", "groq-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "bad" } }), { status: 401 })));
    const result = await transcribeAudio({ audioFile: new Blob([new Uint8Array([1])]) });
    expect(result).toMatchObject({ code: "TRANSCRIPTION_FAILED", status: 401 });
    expect(JSON.stringify(result)).not.toContain("groq-test-key");
  });
});
