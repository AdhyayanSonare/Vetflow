import { describe, expect, it, vi } from "vitest";
import { extractConsultationDetails } from "./extraction";

const ok = { notes: { complaint: "cough", duration: "", examination: "", diagnosis: "", treatment: "", followUp: "" }, medicines: [], lines: [], model: "m" };

describe("extractConsultationDetails", () => {
  it("posts the transcript as JSON and returns the structured result", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(ok)));
    await expect(extractConsultationDetails("Bella has a cough", { fetchImpl })).resolves.toEqual(ok);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/consultation/extract");
    expect(JSON.parse(init.body as string)).toEqual({ transcript: "Bella has a cough" });
  });
  it("passes the catalogue-matched lines through, and defaults to none when the server omits them", async () => {
    const line = { drugText: "Ondansetron", itemId: "i1", itemName: "Ondansetron", matchScore: 1, candidates: [], dose: "4 mg", route: null, frequency: null, duration: null, instructions: null, quantity: null, unmatched: false, reason: null };
    const withLines = vi.fn(async () => new Response(JSON.stringify({ ...ok, lines: [line] })));
    await expect(extractConsultationDetails("x", { fetchImpl: withLines })).resolves.toMatchObject({ lines: [line] });
    const without = vi.fn(async () => new Response(JSON.stringify({ notes: ok.notes, medicines: [], model: "m" })));
    await expect(extractConsultationDetails("x", { fetchImpl: without })).resolves.toMatchObject({ lines: [] });
  });
  it("surfaces server messages and handles network failure", async () => {
    const bad = vi.fn(async () => new Response(JSON.stringify({ error: { code: "SERVICE_ERROR", message: "try again" } }), { status: 502 }));
    await expect(extractConsultationDetails("x", { fetchImpl: bad })).rejects.toMatchObject({ code: "SERVICE_ERROR", message: "try again" });
    const down = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    await expect(extractConsultationDetails("x", { fetchImpl: down })).rejects.toMatchObject({ code: "NETWORK" });
  });
  it("rejects a malformed success payload", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ hello: 1 })));
    await expect(extractConsultationDetails("x", { fetchImpl })).rejects.toMatchObject({ code: "SERVICE_ERROR" });
  });
});
