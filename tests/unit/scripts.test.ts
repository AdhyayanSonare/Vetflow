import path from "node:path";
import { describe, expect, it } from "vitest";
import { findProblems } from "../../scripts/check-licences";
import { longPathAdvice } from "../../scripts/lib/embedded";
import { scanText } from "../../scripts/scan-secrets";

describe("licence allow list", () => {
  const pkg = (name: string) => [{ name, versions: ["1.0.0"] }];
  it("passes permissive licences and compound permissive expressions", () => {
    expect(findProblems({ MIT: pkg("a"), "Apache-2.0": pkg("b"), ISC: pkg("c"), "BSD-3-Clause": pkg("d"), PostgreSQL: pkg("e"), "(MIT OR Apache-2.0)": pkg("f") })).toEqual([]);
  });
  it("flags copyleft licences and anything unknown", () => {
    const bad = findProblems({ "GPL-3.0": pkg("g"), "AGPL-3.0-or-later": pkg("h"), "LGPL-2.1": pkg("i"), "SEE LICENSE IN X": pkg("j") });
    expect(bad.map(b => b.name).sort()).toEqual(["g", "h", "i", "j"]);
  });
  it("reads SPDX expressions: OR passes when one side is allowed, AND needs both", () => {
    expect(findProblems({ "(MIT OR GPL-3.0-or-later)": pkg("dual"), "MIT AND ISC": pkg("both"), "MIT/X11": pkg("slash") })).toEqual([]);
    expect(findProblems({ "(MIT AND GPL-3.0)": pkg("k"), "GPL-2.0 OR LGPL-3.0": pkg("l") })).toHaveLength(2);
  });
  it("allows a build-only exception, but never for a package that ships", () => {
    const light = { "MPL-2.0": [{ name: "lightningcss", versions: ["1"] }] };
    expect(findProblems(light, {})).toEqual([]);
    expect(findProblems(light, light)).toHaveLength(1);
    expect(findProblems({ "MPL-2.0": pkg("some-other-tool") }, {})).toHaveLength(1);
  });
  it("allows the Open Font Licence only for the three brand typefaces", () => {
    expect(findProblems({ "OFL-1.1": [{ name: "@fontsource-variable/geist", versions: ["5"] }] })).toEqual([]);
    expect(findProblems({ "OFL-1.1": [{ name: "some-other-font", versions: ["1"] }] })).toHaveLength(1);
  });
});

describe("secret scanner", () => {
  const scan = (s: string) => scanText("f.ts", s).map(h => h.rule);
  it("finds keys, tokens and real passwords in connection strings", () => {
    expect(scan("const k = 'gsk_" + "a".repeat(40) + "'")).toEqual(["Groq API key"]);   // secret-scan:allow
    expect(scan("-----BEGIN " + "PRIVATE KEY-----")).toEqual(["private key"]);          // secret-scan:allow
    expect(scan("AKIA" + "ABCDEFGHIJKLMNOP")).toEqual(["AWS access key"]);              // secret-scan:allow
    expect(scan("postgresql://postgres.abc:Sup3rS3cretPw@aws-0-region.pooler.supabase.com:5432/postgres")).toEqual(["password in a connection string"]); // secret-scan:allow
  });
  it("allows placeholders, local development URLs and Docker-network hosts", () => {
    expect(scan("postgresql://vetflow_app:<APP_DB_PASSWORD>@aws-0.pooler.supabase.com/postgres")).toEqual([]);
    expect(scan("postgres://postgres:admin_pw@localhost:5432/postgres")).toEqual([]);
    expect(scan("postgres://vetflow_app:${APP_DB_PASSWORD}@postgres:5432/vetflow")).toEqual([]);
    expect(scan("DATABASE_URL=")).toEqual([]);
  });
  it("honours an explicit allow marker on a fixture line", () => {
    expect(scan("gsk_" + "a".repeat(40) + " // secret-scan:allow")).toEqual([]);
  });
});

describe("Windows long-path advice", () => {
  const deep = path.win32.join("C:", "Users", "Someone With A Long Name", "OneDrive - Some Company Pvt Ltd", "Documents", "Projects", "Clients", "Veterinary", "Vetflow");
  it("explains the problem for a deep Windows folder and names a fix", () => {
    const advice = longPathAdvice(deep, "win32");
    expect(advice).toContain(`${deep.length} characters`);
    expect(advice).toContain("shorter folder such as C:\\Vetflow,");
  });
  it("stays quiet for a short Windows folder and on other systems", () => {
    expect(longPathAdvice(path.win32.join("D:", "Vetflow"), "win32")).toBeNull();
    expect(longPathAdvice(deep, "linux")).toBeNull();
    expect(longPathAdvice(deep, "darwin")).toBeNull();
  });
});
