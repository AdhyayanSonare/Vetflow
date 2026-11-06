import { describe, expect, it } from "vitest";
import { searchPatients } from "./patientSearch";

const p = (id: string, name: string, owner: string, phone: string, species = "Dog", breed = "Labrador") => ({ id, name, owner, phone, species, breed });
const patients = [
  p("VET-2026-00124", "Bruno", "Rahul Sharma", "9876543210"),
  p("VET-2026-00125", "Bella", "Priya Patel", "9876543211", "Cat", "Persian"),
  p("VET-2026-00126", "Max", "Amit Verma", "9876543212", "Dog", "Pug"),
  p("VET-2026-00129", "Brownie", "Zoë Müller", "98 765-43219", "Dog", "Beagle"),
];
const names = (query: string) => searchPatients(patients, query).map(x => x.name);

describe("searchPatients", () => {
  it("returns everyone for an empty query", () => expect(names("  ")).toHaveLength(4));
  it("matches name, owner, id, breed and species case-insensitively", () => {
    expect(names("BRUNO")).toEqual(["Bruno"]);
    expect(names("priya")).toEqual(["Bella"]);
    expect(names("00126")).toEqual(["Max"]);
    expect(names("persian")).toEqual(["Bella"]);
    expect(names("cat")).toEqual(["Bella"]);
  });
  it("requires every word to match, in any field", () => {
    expect(names("bruno rahul")).toEqual(["Bruno"]);
    expect(names("bruno priya")).toEqual([]);
  });
  it("finds phone numbers by partial digits, ignoring spaces and dashes", () => {
    expect(names("543212")).toEqual(["Max"]);
    expect(names("9876543219")).toEqual(["Brownie"]);
  });
  it("ignores accents", () => {
    expect(names("zoe muller")).toEqual(["Brownie"]);
  });
  it("ranks name-prefix matches ahead of other matches and respects the limit", () => {
    expect(names("br")).toEqual(["Bruno", "Brownie"]);
    expect(searchPatients(patients, "", 2)).toHaveLength(2);
  });
});
