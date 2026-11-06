import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_TRANSCRIPT_CHARS } from "../shared/extraction";
import { groundMedicines } from "./_core/consultationExtraction";
import { createExtractionRouter } from "./consultationExtract";

const realFetch = globalThis.fetch;
const transcript = "Bruno has vomited since yesterday. Temperature is 102 degrees. I prescribe Ondansetron 4 milligrams twice a day for three days.";
let server: Server;
let base: string;
let groq: ReturnType<typeof vi.fn>;

const groqReply = (content: unknown, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }), { status });

const modelOutput = {
  notes: { complaint: "Vomiting since yesterday", duration: "since yesterday", examination: "Temperature 102 degrees", diagnosis: "", treatment: "", followUp: "" },
  medicines: [{ name: "Ondansetron", strength: "", dosage: "4 milligrams", route: "", frequency: "twice a day", duration: "three days", instructions: "" }],
};

beforeEach(async () => {
  vi.stubEnv("GROQ_API_KEY", "groq-test-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
  const app = express();
  app.use(createExtractionRouter());
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  groq = vi.fn(async () => groqReply(modelOutput));
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => (String(input).startsWith(base) ? realFetch(input, init) : groq(input, init)));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await new Promise(resolve => server.close(resolve));
});

const post = (body: unknown) =>
  realFetch(`${base}/api/consultation/extract`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("POST /api/consultation/extract (Groq mocked)", () => {
  it("sends the transcript to the Groq chat model and returns structured notes and medicines", async () => {
    const res = await post({ transcript });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.notes).toMatchObject({ complaint: "Vomiting since yesterday", diagnosis: "" });
    expect(json.medicines).toEqual([modelOutput.medicines[0]]);

    const [url, init] = groq.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer groq-test-key");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: "openai/gpt-oss-120b", temperature: 0, response_format: { type: "json_object" } });
    expect(body.messages[0].content).toMatch(/ONLY information explicitly stated/);
    expect(body.messages[1].content).toContain(transcript);
  });

  it("drops medicines the transcript never mentions", async () => {
    groq.mockResolvedValueOnce(groqReply({ ...modelOutput, medicines: [...modelOutput.medicines, { name: "Morphine", dosage: "50 mg" }] }));
    const json = await (await post({ transcript })).json();
    expect(json.medicines.map((m: { name: string }) => m.name)).toEqual(["Ondansetron"]);
  });

  it("fills missing fields with empty strings and tolerates no medicines", async () => {
    groq.mockResolvedValueOnce(groqReply({ notes: { complaint: " cough " } }));
    const json = await (await post({ transcript: "Bella has a cough." })).json();
    expect(json.notes).toEqual({ complaint: "cough", duration: "", examination: "", diagnosis: "", treatment: "", followUp: "" });
    expect(json.medicines).toEqual([]);
  });

  it("does not repeat a single stated amount as both strength and dosage", async () => {
    groq.mockResolvedValueOnce(groqReply({ notes: {}, medicines: [{ name: "Ondansetron", strength: "4 milligrams", dosage: "4 milligrams" }] }));
    const json = await (await post({ transcript })).json();
    expect(json.medicines[0]).toMatchObject({ strength: "", dosage: "4 milligrams" });
  });

  it("validates input", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ transcript: "   " })).status).toBe(400);
    expect((await post({ transcript: "x".repeat(MAX_TRANSCRIPT_CHARS + 1) })).status).toBe(400);
    expect(groq).not.toHaveBeenCalled();
  });

  it("returns a retryable error for bad model output or Groq failures, without leaking details", async () => {
    groq.mockResolvedValueOnce(groqReply("not json"));
    expect((await post({ transcript })).status).toBe(502);
    groq.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Invalid key groq-test-key" } }), { status: 401 }));
    const res = await post({ transcript });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("groq-test-key");
    groq.mockResolvedValueOnce(new Response("{}", { status: 429 }));
    expect((await post({ transcript })).status).toBe(429);
  });

  it("reports a missing key without calling Groq, and never logs the transcript", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    const res = await post({ transcript });
    expect(res.status).toBe(503);
    expect(groq).not.toHaveBeenCalled();
    expect(JSON.stringify((console.error as unknown as ReturnType<typeof vi.fn>).mock.calls)).not.toContain("Bruno");
  });
});

describe("groundMedicines", () => {
  const med = (name: string) => ({ name, strength: "", dosage: "", route: "", frequency: "", duration: "", instructions: "" });
  it("keeps medicines named in the transcript (case-insensitive) and drops the rest", () => {
    expect(groundMedicines([med("ONDANSETRON"), med("Morphine"), med("")], transcript).map(m => m.name)).toEqual(["ONDANSETRON"]);
  });
});
