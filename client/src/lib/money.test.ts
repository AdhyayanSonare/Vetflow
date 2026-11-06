import { describe, expect, it } from "vitest";
import { parseRupees, rupeesText } from "./money";

describe("parseRupees", () => {
  it("converts typed rupees to integer paise", () => {
    expect(parseRupees("12.50")).toBe(1250);
    expect(parseRupees("12.5")).toBe(1250);
    expect(parseRupees("99")).toBe(9900);
    expect(parseRupees("1,25,000.75")).toBe(12500075);
    expect(parseRupees("₹ 42.5")).toBe(4250);
    expect(parseRupees("0")).toBe(0);
  });
  it("never goes through floating point", () => {
    expect(parseRupees("0.1")).toBe(10);
    expect(parseRupees("0.07")).toBe(7);
    expect(parseRupees("19.99")).toBe(1999);
    expect(parseRupees("1.15")).toBe(115);
  });
  it("rejects anything that is not an amount", () => {
    for (const bad of ["", "abc", "-5", "1.234", "1..2", "12.", ".5", "1e3"]) expect(parseRupees(bad), bad).toBeNull();
  });
});

describe("rupeesText", () => {
  it("writes paise back as the rupees a person would type", () => {
    expect(rupeesText(1250)).toBe("12.5");
    expect(rupeesText(1205)).toBe("12.05");
    expect(rupeesText(9900)).toBe("99");
    expect(rupeesText(7)).toBe("0.07");
    expect(rupeesText(0)).toBe("");
    expect(rupeesText(null)).toBe("");
  });
  it("round-trips", () => {
    for (const p of [1, 10, 99, 100, 1250, 1999, 12500075]) expect(parseRupees(rupeesText(p)), String(p)).toBe(p);
  });
});
