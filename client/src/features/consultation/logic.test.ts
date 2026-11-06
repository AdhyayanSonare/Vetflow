import { describe, expect, it } from "vitest";
import type { DraftLine } from "@shared/extraction";
import { allergyConflicts, clock, emptyLine, fromDraft, initialPhase, lineProblems, lineSummary, linesNeedingAttention, notesFromConsultation, notesFromExtraction, notesToPatch, toInput } from "./logic";

const draft = (o: Partial<DraftLine> = {}): DraftLine => ({
  drugText: "carprofen", itemId: "i1", itemName: "Carprofen", matchScore: 1,
  candidates: [{ itemId: "i1", name: "Carprofen", strength: "50 mg", unit: "tablet", score: 1 }],
  dose: "1 tablet", route: "oral", frequency: "twice daily", duration: "5 days", instructions: null, quantity: 10, unmatched: false, reason: null, ...o,
});

describe("lines from the drafter", () => {
  it("shows the catalogue name and strength for a match, and keeps what was drafted", () => {
    const l = fromDraft(draft());
    expect(l).toMatchObject({ itemId: "i1", drugText: "Carprofen 50 mg", dose: "1 tablet", frequency: "twice daily", duration: "5 days", quantity: "10", route: "oral" });
    expect(lineProblems(l)).toEqual([]);
  });

  it("keeps an unmatched drug as heard and asks for a catalogue item", () => {
    const l = fromDraft(draft({ itemId: null, itemName: null, drugText: "lysine supplement", candidates: [], unmatched: true, reason: "Not found in the catalogue." }));
    expect(l.drugText).toBe("lysine supplement");
    expect(l.itemId).toBeNull();
    expect(lineProblems(l)).toEqual(["Choose the matching catalogue item."]);
    expect(linesNeedingAttention([l, fromDraft(draft())])).toHaveLength(1);
  });

  it("an ambiguous match offers the candidates and still needs a choice", () => {
    const l = fromDraft(draft({ itemId: null, candidates: [
      { itemId: "a", name: "Amoxicillin", strength: "250 mg", unit: "tablet", score: 0.9 }, { itemId: "b", name: "Amoxicillin", strength: "500 mg", unit: "tablet", score: 0.9 }], unmatched: true }));
    expect(l.candidates).toHaveLength(2);
    expect(lineProblems(l).length).toBe(1);
  });

  it("an empty line asks for a name first", () => {
    expect(lineProblems(emptyLine())).toEqual(["Name the medicine."]);
  });
});

describe("saving lines", () => {
  it("sends trimmed values, nulls for blanks, and a positive number for quantity", () => {
    const l = { ...fromDraft(draft()), dose: "  1 tablet ", instructions: "", quantity: "12" };
    expect(toInput(l)).toEqual({ itemId: "i1", drugText: "Carprofen 50 mg", dose: "1 tablet", route: "oral", frequency: "twice daily", duration: "5 days", instructions: null, quantity: 12 });
    expect(toInput({ ...l, quantity: "" }).quantity).toBeNull();
    expect(toInput({ ...l, quantity: "abc" }).quantity).toBeNull();
    expect(toInput({ ...l, quantity: "-3" }).quantity).toBeNull();
    expect(lineProblems({ ...l, quantity: "0" })).toContain("Quantity must be more than 0.");
  });
  it("summarises a line, and says so when no dose was stated", () => {
    expect(lineSummary({ dose: "1 tablet", frequency: "twice daily", duration: "5 days", route: "oral" })).toBe("1 tablet · twice daily · 5 days · oral");
    expect(lineSummary({ dose: "", frequency: "", duration: "", route: "" })).toBe("Dose not stated");
  });
});

describe("allergy cross-check", () => {
  const lines = [{ key: "a", drugText: "Amoxicillin Clavulanate 500 mg" }, { key: "b", drugText: "Carprofen 50 mg" }];
  it("flags a medicine that contains an allergen from the note", () => {
    expect(allergyConflicts(lines, "Penicillin, sulfa drugs")).toEqual([]);          // amoxicillin is not spelled penicillin: no false claim
    expect(allergyConflicts(lines, "Amoxicillin")).toEqual([{ key: "a", allergen: "amoxicillin" }]);
    expect(allergyConflicts(lines, "carprofen allergy")).toEqual([{ key: "b", allergen: "carprofen" }]);
  });
  it("says nothing when there is no allergy note or only filler words", () => {
    expect(allergyConflicts(lines, null)).toEqual([]);
    expect(allergyConflicts(lines, "None known")).toEqual([]);
    expect(allergyConflicts(lines, "   ")).toEqual([]);
  });
});

describe("notes", () => {
  it("drafted notes fill empty fields and never wipe what the vet already wrote", () => {
    const current = { ...notesFromConsultation({}), diagnosis: "Gastritis (vet's own)", complaint: "" };
    const out = notesFromExtraction({ complaint: "Vomiting", duration: "1 day", examination: "", diagnosis: "something else", treatment: "", followUp: "" }, current);
    expect(out.complaint).toBe("Vomiting");
    expect(out.durationText).toBe("1 day");
    expect(out.diagnosis).toBe("something else");   // the drafter said it; the vet reviews before saving
    expect(out.examination).toBe("");               // not said stays empty
    expect(notesFromExtraction({ complaint: "", duration: "", examination: "", diagnosis: "", treatment: "", followUp: "" }, current).diagnosis).toBe("Gastritis (vet's own)");
  });
  it("builds a patch that leaves blanks out and rejects an impossible temperature", () => {
    const patch = notesToPatch({ ...notesFromConsultation({}), complaint: " Cough ", temperatureF: "102.4" });
    expect(patch).toMatchObject({ complaint: "Cough", temperatureF: 102.4 });
    expect(patch.diagnosis).toBeUndefined();
    expect(notesToPatch({ ...notesFromConsultation({}), temperatureF: "9000" }).temperatureF).toBeUndefined();
  });
  it("reads stored notes back, including a numeric temperature", () => {
    expect(notesFromConsultation({ complaint: "Limp", temperatureF: 101.5 })).toMatchObject({ complaint: "Limp", temperatureF: "101.5", diagnosis: "" });
  });
});

describe("where a consultation resumes", () => {
  const c = (o = {}) => ({ status: "draft" as const, transcripts: [], ...o });
  it("opens at the recorder when nothing has happened", () => expect(initialPhase(c())).toBe("ready"));
  it("opens at the notes once a transcript or any note exists", () => {
    expect(initialPhase(c({ transcripts: [{}] }))).toBe("notes");
    expect(initialPhase(c({ complaint: "Cough" }))).toBe("notes");
    expect(initialPhase(c({ complaint: "   " }))).toBe("ready");
  });
  it("opens at the prescription when a draft exists", () => expect(initialPhase(c({ complaint: "x" }), { status: "draft" })).toBe("prescription"));
  it("opens at the summary when approved or completed", () => {
    expect(initialPhase(c(), { status: "approved" })).toBe("done");
    expect(initialPhase({ status: "completed", transcripts: [] })).toBe("done");
  });
});

describe("clock", () => {
  it("formats seconds as mm:ss", () => {
    expect(clock(0)).toBe("00:00");
    expect(clock(75)).toBe("01:15");
    expect(clock(3599)).toBe("59:59");
  });
});
