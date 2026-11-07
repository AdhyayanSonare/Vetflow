import { describe, expect, it } from "vitest";
import { drugHits, normalise, rate, wordErrors } from "../../eval/asr/metrics";

describe("speech evaluation scoring", () => {
  it("normalises case, punctuation and hyphens, and keeps Devanagari", () => {
    expect(normalise("Give Amoxicillin, 250-mg: twice daily!")).toEqual(["give", "amoxicillin", "250mg", "twice", "daily"]);
    expect(normalise("दिन में दो बार")).toEqual(["दिन", "में", "दो", "बार"]);
  });

  it("counts substitutions, insertions and deletions", () => {
    expect(wordErrors("give the dog one tablet", "give the dog one tablet")).toEqual({ errors: 0, refWords: 5 });
    expect(wordErrors("give the dog one tablet", "give a dog one tablet").errors).toBe(1); // substitution
    expect(wordErrors("give the dog one tablet", "give the dog one").errors).toBe(1); // deletion
    expect(wordErrors("give the dog", "please give the big dog").errors).toBe(2); // two insertions
    expect(wordErrors("one two three", "four five six").errors).toBe(3);
  });

  it("ignores case and punctuation when scoring, and handles an empty reference or hypothesis", () => {
    expect(wordErrors("Give the dog, one tablet.", "give the dog one tablet").errors).toBe(0);
    expect(wordErrors("one two", "").errors).toBe(2);
    expect(rate({ errors: 0, refWords: 0 })).toBeNull();
    expect(rate({ errors: 1, refWords: 4 })).toBe(0.25);
  });

  it("scores the corpus by summing errors, not by averaging clip rates", () => {
    const a = wordErrors("one two three four five six seven eight nine ten", "one two three four five six seven eight nine ten"); // 0 of 10
    const b = wordErrors("one two", "three four"); // 2 of 2
    const total = { errors: a.errors + b.errors, refWords: a.refWords + b.refWords };
    expect(rate(total)).toBeCloseTo(2 / 12);
  });

  it("finds listed drug names said in the reference and reports which came back", () => {
    const drugs = ["amoxicillin", "carprofen", "metronidazole"];
    const r = drugHits("Start carprofen and amoxicillin today", "start car pro fen and amoxicillin today", drugs);
    expect(r.expected).toEqual(["amoxicillin", "carprofen"]);
    expect(r.found).toEqual(["amoxicillin"]);
    expect(r.missed).toEqual(["carprofen"]);
  });

  it("matches whole words only and ignores drugs the reference never mentions", () => {
    expect(drugHits("two amoxicillins", "two amoxicillin", ["amoxicillin"]).expected).toEqual([]);
    expect(drugHits("nothing relevant here", "carprofen", ["carprofen"])).toEqual({ expected: [], found: [], missed: [] });
    expect(drugHits("give insulin glargine", "give insulin glargine", ["Insulin Glargine"]).found).toEqual(["Insulin Glargine"]);
  });
});
