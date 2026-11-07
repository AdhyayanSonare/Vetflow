import { execFileSync } from "node:child_process";

/**
 * Fails if any installed package (runtime or development) has a licence outside the allow list.
 * Allowed: MIT, ISC, BSD, Apache-2.0, 0BSD, PostgreSQL and a few equivalent permissive licences.
 * The three typeface packages use the SIL Open Font Licence, which the brand brief requires, so they
 * are allowed by name and nothing else is.
 */
export const ALLOWED = new Set([
  "MIT", "MIT-0", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "PostgreSQL", "CC0-1.0", "Unlicense", "BlueOak-1.0.0", "Python-2.0",
  "Zlib", "CC-BY-4.0", "BSD", "MIT*",
]);
/** Packages allowed by name and exact licence. The fonts are required by the brand brief. */
export const BY_NAME: Record<string, string> = {
  "@fontsource-variable/bricolage-grotesque": "OFL-1.1",
  "@fontsource-variable/geist": "OFL-1.1",
  "@fontsource-variable/geist-mono": "OFL-1.1",
};
/**
 * Build-time tools whose licence is outside the list. Each is allowed only while it is absent from the
 * production tree (what ships in the Docker image), and each needs a reason. Review these with the client.
 */
export const BUILD_ONLY: Record<string, { licence: string; reason: string }> = {
  lightningcss: { licence: "MPL-2.0", reason: "CSS compiler used by the Tailwind 4 Vite plugin at build time; unmodified and not shipped" },
  "lightningcss-win32-x64-msvc": { licence: "MPL-2.0", reason: "platform binary of lightningcss" },
  "lightningcss-darwin-arm64": { licence: "MPL-2.0", reason: "platform binary of lightningcss" },
  "lightningcss-darwin-x64": { licence: "MPL-2.0", reason: "platform binary of lightningcss" },
  "lightningcss-linux-x64-gnu": { licence: "MPL-2.0", reason: "platform binary of lightningcss" },
  "lightningcss-linux-x64-musl": { licence: "MPL-2.0", reason: "platform binary of lightningcss" },
  "lightningcss-linux-arm64-gnu": { licence: "MPL-2.0", reason: "platform binary of lightningcss" },
  "lightningcss-linux-arm64-musl": { licence: "MPL-2.0", reason: "platform binary of lightningcss" },
};

export type Finding = { name: string; version: string; licence: string };
type Grouped = Record<string, Array<{ name: string; versions: string[] }>>;

/**
 * Evaluates an SPDX expression against the allow list. `A OR B` passes when either side does (the
 * package may be used under that licence); `A AND B` needs both; `AND` binds tighter than `OR`.
 */
export function licenceAllowed(expression: string): boolean {
  const tokens = expression.replace(/\//g, " OR ").match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  const parseOr = (): boolean => {
    let ok = parseAnd();
    while (tokens[i] === "OR") { i++; const rhs = parseAnd(); ok = ok || rhs; }
    return ok;
  };
  const parseAnd = (): boolean => {
    let ok = parseAtom();
    while (tokens[i] === "AND") { i++; const rhs = parseAtom(); ok = ok && rhs; }
    return ok;
  };
  const parseAtom = (): boolean => {
    const t = tokens[i++];
    if (t === undefined) return false;
    if (t === "(") { const ok = parseOr(); if (tokens[i] === ")") i++; return ok; }
    return ALLOWED.has(t);
  };
  if (tokens.length === 0) return false;
  const ok = parseOr();
  return ok && i === tokens.length;
}

/** Pure check over pnpm's grouped output, so it can be tested without installing anything. */
export function findProblems(all: Grouped, prod: Grouped = {}): Finding[] {
  const shipped = new Set(Object.values(prod).flat().map(p => p.name));
  const out: Finding[] = [];
  for (const [licence, pkgs] of Object.entries(all)) {
    for (const p of pkgs) {
      const named = BY_NAME[p.name] === licence;
      const buildOnly = BUILD_ONLY[p.name]?.licence === licence && !shipped.has(p.name);
      if (!named && !buildOnly && !licenceAllowed(licence)) out.push({ name: p.name, version: p.versions.join(", "), licence });
    }
  }
  return out;
}

if (process.argv[1] && /check-licences\.(ts|js)$/.test(process.argv[1])) {
  // Run pnpm through the same Node that runs this script when possible, so no shell is involved.
  const pnpmJs = process.env.npm_execpath && /\.c?js$/.test(process.env.npm_execpath) ? process.env.npm_execpath : undefined;
  const run = (args: string[]) => pnpmJs
    ? execFileSync(process.execPath, [pnpmJs, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    : execFileSync("pnpm", args, { encoding: "utf8", shell: process.platform === "win32", maxBuffer: 64 * 1024 * 1024 });
  const list = (extra: string[]) => JSON.parse(run(["licenses", "list", "--json", ...extra])) as Grouped;
  const grouped = list([]);
  const problems = findProblems(grouped, list(["--prod"]));
  const total = Object.values(grouped).reduce((n, a) => n + a.length, 0);
  if (problems.length) {
    console.error(`Licence check failed: ${problems.length} package(s) are outside the allow list.`);
    for (const p of problems) console.error(`  ${p.name}@${p.version}: ${p.licence}`);
    process.exit(1);
  }
  const used = Object.entries(BUILD_ONLY).filter(([n]) => Object.values(grouped).flat().some(p => p.name === n)).map(([n]) => n);
  console.log(`Licence check passed: ${total} packages, all on the allow list${used.length ? `; build-only exceptions in use: ${used.join(", ")}` : ""}.`);
}
