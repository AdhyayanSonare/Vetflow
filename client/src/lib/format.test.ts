import { describe, expect, it } from "vitest";
import { addDays, ageFrom, daysUntil, dateIST, expiryStatus, initials, money, plural, qty, timeIST, todayIST } from "./format";

describe("money", () => {
  it("shows rupees with Indian digit grouping", () => {
    expect(money(123456789)).toBe("₹12,34,567.89");
    expect(money(100000)).toBe("₹1,000.00");
    expect(money(250, 2)).toBe("₹2.50");
    expect(money(1234500, 0)).toBe("₹12,345");
  });
  it("shows a dash for a missing value, and still formats zero", () => {
    expect(money(null)).toBe("—");
    expect(money(undefined)).toBe("—");
    expect(money(0)).toBe("₹0.00");
  });
});

describe("quantities", () => {
  it("trims zeros and keeps up to three decimals", () => {
    expect(qty(12)).toBe("12");
    expect(qty(2.5, "ml")).toBe("2.5 ml");
    expect(qty(0.125)).toBe("0.125");
    expect(qty(1234567)).toBe("12,34,567");
    expect(qty(null)).toBe("—");
  });
  it("pluralises", () => {
    expect(plural(1, "item")).toBe("1 item");
    expect(plural(2, "item")).toBe("2 items");
    expect(plural(1200, "batch", "batches")).toBe("1,200 batches");
  });
});

describe("dates are shown in India time", () => {
  it("converts a UTC instant to Asia/Kolkata", () => {
    expect(timeIST("2026-11-06T21:30:00Z")).toBe("03:00");
    expect(dateIST("2026-11-06T21:30:00Z")).toBe("7 Nov 2026");
  });
  it("shows a plain calendar date as is", () => {
    expect(dateIST("2027-08-31")).toBe("31 Aug 2027");
    expect(dateIST(null)).toBe("—");
    expect(dateIST("not a date")).toBe("—");
  });
  it("knows today in India even when UTC is still yesterday", () => {
    expect(todayIST(new Date("2026-11-06T21:30:00Z"))).toBe("2026-11-07");
    expect(todayIST(new Date("2026-11-06T18:00:00Z"))).toBe("2026-11-06");
  });
  it("does date arithmetic without drifting across month ends", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysUntil("2026-12-31", "2026-11-07")).toBe(54);
  });
});

describe("expiry status", () => {
  const today = "2026-11-07";
  it("flags expired and near-expiry stock in danger", () => {
    expect(expiryStatus("2026-10-25", today)).toMatchObject({ tone: "danger", label: "Expired 13 days ago" });
    expect(expiryStatus("2026-11-07", today)).toMatchObject({ tone: "danger", label: "Expires today" });
    expect(expiryStatus("2026-11-27", today)).toMatchObject({ tone: "danger", label: "20 days left" });
  });
  it("warns inside the alert window and is quiet beyond it", () => {
    expect(expiryStatus("2027-01-20", today)).toMatchObject({ tone: "warn", days: 74 });
    expect(expiryStatus("2028-01-20", today)).toMatchObject({ tone: "neutral", label: "20 Jan 2028" });
  });
});

describe("people and animals", () => {
  it("makes initials", () => {
    expect(initials("Dr. Meera Sharma")).toBe("DM");
    expect(initials("Bruno")).toBe("B");
    expect(initials("")).toBe("");
  });
  it("describes age in a sensible unit", () => {
    expect(ageFrom("2026-11-01", "2026-11-07")).toBe("6 d");
    expect(ageFrom("2026-09-20", "2026-11-07")).toBe("6 wk");
    expect(ageFrom("2026-02-01", "2026-11-07")).toBe("9 mo");
    expect(ageFrom("2022-03-14", "2026-11-07")).toBe("4 yr");
    expect(ageFrom(null)).toBe("");
    expect(ageFrom("2030-01-01", "2026-11-07")).toBe("");
  });
});
