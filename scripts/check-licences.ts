import { execFileSync } from "node:child_process";

/**
 * Fails if any installed package (runtime or development) has a licence outside the allow list.
 * Allowed: MIT, ISC, BSD, Apache-2.0, 0BSD, PostgreSQL and a few equivalent permissive licences.
 * The three typeface packages use the SIL Open Font Licence, which the brand brief requires, so they
 * are allowed by name and nothing else is.
 */
export const ALLOWED = new Set([
  "MIT", "MIT-0", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "PostgreSQL", "CC0-1.0", "Unlicense", "BlueOak-1.0.0", "Python-2.0",
  "MIT*", "(MIT OR CC0-1.0)", "(MIT OR Apache-2.0)", "(BSD-2-Clause OR MIT OR Apache-2.0)", "(MIT AND Zlib)", "Zlib", "CC-BY-4.0", "(MIT AND BSD-3-Clause)", "BSD",
]);
export const BY_NAME: Record<string, string> = {
  "@fontsource-variable/source-serif-4": "OFL-1.1",
  "@fontsource/ibm-plex-sans": "OFL-1.1",
  "@fontsource/ibm-plex-mono": "OFL-1.1",
};
const FORBIDDEN = /(^|[^L])GPL|AGPL|SSPL|BUSL|Commons-Clause/i;

export type Finding = { name: string; version: string; licence: string };

/** Pure check over pnpm's grouped output, so it can be tested without installing anything. */
export function findProblems(byLicence: Record<string, Array<{ name: string; versions: string[] }>>): Finding[] {
  const out: Finding[] = [];
  for (const [licence, pkgs] of Object.entries(byLicence)) {
    for (const p of pkgs) {
      const exempt = BY_NAME[p.name] === licence;
      const ok = exempt || ALLOWED.has(licence) || (!FORBIDDEN.test(licence) && licence.split(/ OR | AND |[()]/).map(s => s.trim()).filter(Boolean).every(l => ALLOWED.has(l)));
      if (!ok) out.push({ name: p.name, version: p.versions.join(", "), licence });
    }
  }
  return out;
}

if (process.argv[1] && /check-licences\.(ts|js)$/.test(process.argv[1])) {
  const raw = execFileSync("pnpm", ["licenses", "list", "--json"], { encoding: "utf8", shell: process.platform === "win32", maxBuffer: 64 * 1024 * 1024 });
  const grouped = JSON.parse(raw) as Record<string, Array<{ name: string; versions: string[] }>>;
  const problems = findProblems(grouped);
  const total = Object.values(grouped).reduce((n, a) => n + a.length, 0);
  if (problems.length) {
    console.error(`Licence check failed: ${problems.length} package(s) are outside the allow list.`);
    for (const p of problems) console.error(`  ${p.name}@${p.version}: ${p.licence}`);
    process.exit(1);
  }
  console.log(`Licence check passed: ${total} packages, all on the allow list.`);
}
