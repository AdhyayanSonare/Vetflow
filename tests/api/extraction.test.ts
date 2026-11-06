import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EXTRACT_PATH, MAX_TRANSCRIPT_CHARS } from "../../shared/extraction";
import { createExtractor, groundMedicines } from "../../server/modules/voice/extract";
import { harness } from "../harness";

const h = harness();
beforeAll(async () => { await h.init(); });
afterAll(async () => { await h.done(); });

const cfg = { apiKey: "groq-test-key", apiUrl: "https://api.groq.com/openai/v1", transcribeModel: "whisper-large-v3", extractionModel: "openai/gpt-oss-120b" };
const transcript = "Bruno has vomited since yesterday. Temperature is 102 degrees. I prescribe Ondansetron 4 milligrams twice a day for three days.";
const groqReply = (content: unknown, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }), { status });
const modelOutput = {
  notes: { complaint: "Vomiting since yesterday", duration: "since yesterday", examination: "Temperature 102 degrees", diagnosis: "", treatment: "", followUp: "" },
  medicines: [{ name: "Ondansetron", strength: "", dosage: "4 milligrams", route: "", frequency: "twice a day", duration: "three days", instructions: "" }],
};

/** A tenant with a vet who has the extractor wired to a fake chat endpoint. */
async function world(reply: () => Response | Promise<Response> = () => groqReply(modelOutput)) {
  const fake = vi.fn(async (_url: unknown, _init?: unknown) => reply());
  const w = await h.stocked();
  await w.mgr.call("POST", "/api/items", { genericName: "Ondansetron", strength: "4 mg", unit: "tablet", confirmSimilar: true });
  const vet = await h.as(w.f, "vet", { extractor: createExtractor(cfg, fake as unknown as typeof fetch) });
  return { ...w, vet, fake };
}

describe("note extraction", () => {
  it("sends the transcript to the chat model and returns notes, medicines and catalogue-matched lines", async () => {
    const w = await world();
    const r = await w.vet.call("POST", EXTRACT_PATH, { transcript });
    expect(r.status).toBe(200);
    expect(r.json.notes).toMatchObject({ complaint: "Vomiting since yesterday", diagnosis: "" });
    expect(r.json.medicines).toEqual([modelOutput.medicines[0]]);
    expect(r.json.lines[0]).toMatchObject({ drugText: "Ondansetron", itemName: "Ondansetron", unmatched: false, dose: "4 milligrams", frequency: "twice a day" });
    expect(r.json.lines[0].itemId).toBeTruthy();
    expect(r.headers.get("cache-control")).toBe("no-store");

    const [url, init] = w.fake.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer groq-test-key");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: "openai/gpt-oss-120b", temperature: 0, response_format: { type: "json_object" } });
    expect(body.messages[0].content).toMatch(/ONLY information explicitly stated/);
    expect(body.messages[1].content).toContain(transcript);
  });

  it("drops medicines the transcript never mentions, and flags one the catalogue lacks", async () => {
    const w = await world(() => groqReply({ ...modelOutput, medicines: [...modelOutput.medicines, { name: "Morphine", dosage: "50 mg" }, { name: "Metronidazole" }] }));
    const r = await w.vet.call("POST", EXTRACT_PATH, { transcript: transcript + " Also metronidazole." });
    expect(r.json.medicines.map((m: { name: string }) => m.name)).toEqual(["Ondansetron", "Metronidazole"]);
    expect(r.json.lines.map((l: { unmatched: boolean }) => l.unmatched)).toEqual([false, true]);
    expect(r.json.lines[1].reason).toMatch(/Not found/);
  });

  it("fills missing fields with empty strings and tolerates no medicines", async () => {
    const w = await world(() => groqReply({ notes: { complaint: " cough " } }));
    const r = await w.vet.call("POST", EXTRACT_PATH, { transcript: "Bella has a cough." });
    expect(r.json.notes).toEqual({ complaint: "cough", duration: "", examination: "", diagnosis: "", treatment: "", followUp: "" });
    expect(r.json.medicines).toEqual([]);
    expect(r.json.lines).toEqual([]);
  });

  it("does not repeat a single stated amount as both strength and dosage", async () => {
    const w = await world(() => groqReply({ notes: {}, medicines: [{ name: "Ondansetron", strength: "4 milligrams", dosage: "4 milligrams" }] }));
    const r = await w.vet.call("POST", EXTRACT_PATH, { transcript });
    expect(r.json.medicines[0]).toMatchObject({ strength: "", dosage: "4 milligrams" });
  });

  it("validates input before calling the model", async () => {
    const w = await world();
    expect((await w.vet.call("POST", EXTRACT_PATH, {})).status).toBe(400);
    expect((await w.vet.call("POST", EXTRACT_PATH, { transcript: "   " })).json.error.code).toBe("INVALID_INPUT");
    expect((await w.vet.call("POST", EXTRACT_PATH, { transcript: "x".repeat(MAX_TRANSCRIPT_CHARS + 1) })).status).toBe(400);
    expect(w.fake).not.toHaveBeenCalled();
  });

  it("returns a retryable error for bad model output or provider failures, without leaking details", async () => {
    let n = 0;
    const replies = [() => groqReply("not json"), () => new Response(JSON.stringify({ error: { message: "Invalid key groq-test-key" } }), { status: 401 }), () => new Response("{}", { status: 429 })];
    const w = await world(() => replies[n++]());
    expect((await w.vet.call("POST", EXTRACT_PATH, { transcript })).status).toBe(502);
    const second = await w.vet.call("POST", EXTRACT_PATH, { transcript });
    expect(second.status).toBe(502);
    expect(second.text).not.toContain("groq-test-key");
    expect((await w.vet.call("POST", EXTRACT_PATH, { transcript })).status).toBe(429);
  });

  it("needs sign-in, the clinical role, the tenant voice switch, and a configured provider", async () => {
    const w = await world();
    const anon = await h.as(w.f, "viewer", { extractor: createExtractor(cfg, vi.fn() as unknown as typeof fetch) });
    expect((await anon.call("POST", EXTRACT_PATH, { transcript })).status).toBe(403);
    await h.admin.query("update tenant_settings set voice_enabled=false where tenant_id=$1", [w.f.tenantId]);
    expect((await w.vet.call("POST", EXTRACT_PATH, { transcript })).json.error.code).toBe("voice_disabled");
    await h.admin.query("update tenant_settings set voice_enabled=true where tenant_id=$1", [w.f.tenantId]);
    const none = await h.as(w.f, "vet", { extractor: null });
    const r = await none.call("POST", EXTRACT_PATH, { transcript });
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe("NOT_CONFIGURED");
  });

  it("matches only this tenant's catalogue, and saves nothing", async () => {
    const a = await world();
    const b = await world();
    await h.admin.query("delete from items where tenant_id=$1 and generic_name='Ondansetron'", [b.f.tenantId]);
    const r = await b.vet.call("POST", EXTRACT_PATH, { transcript });
    expect(r.json.lines[0]).toMatchObject({ itemId: null, unmatched: true });
    expect(JSON.stringify(r.json)).not.toContain(a.item.id);
    expect((await h.admin.query("select count(*)::int n from prescriptions where tenant_id=$1", [a.f.tenantId])).rows[0].n).toBe(0);
  });
});

describe("groundMedicines", () => {
  const med = (name: string) => ({ name, strength: "", dosage: "", route: "", frequency: "", duration: "", instructions: "" });
  it("keeps medicines named in the transcript (case-insensitive) and drops the rest", () => {
    expect(groundMedicines([med("ONDANSETRON"), med("Morphine"), med("")], transcript).map(m => m.name)).toEqual(["ONDANSETRON"]);
  });
});
