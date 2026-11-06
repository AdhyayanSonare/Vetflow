// Stop hook: before Claude hands control back, the type check and the fast tests must pass.
// If something fails, exit 2 sends the failures back to Claude so it fixes them first.
// It skips the work when nothing changed since the last passing run, and never loops
// (stop_hook_active is set when this hook already blocked once in the same stop sequence).
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
if (input.stop_hook_active) process.exit(0);

const root = input.cwd ?? process.cwd();
if (!existsSync(path.join(root, "node_modules", "typescript"))) process.exit(0);

/** A fingerprint of the working tree: which files are modified or new, and their size and time. */
function fingerprint() {
  let status = "";
  try {
    status = execFileSync("git", ["status", "--porcelain=v1", "-uall"], { cwd: root, encoding: "utf8" });
  } catch {
    return null;
  }
  const h = createHash("sha1").update(status);
  for (const line of status.split("\n")) {
    const file = line.slice(3).trim();
    if (!file) continue;
    try {
      const s = statSync(path.join(root, file));
      h.update(`${file}:${s.size}:${s.mtimeMs}`);
    } catch {
      // deleted file: the status line already says so
    }
  }
  return h.digest("hex");
}

const stampFile = path.join(root, "node_modules", ".cache", "stop-hook-stamp");
const now = fingerprint();
if (now && existsSync(stampFile) && readFileSync(stampFile, "utf8") === now) process.exit(0);

const node = process.execPath;
const run = (label, args) => {
  const r = spawnSync(node, args, { cwd: root, encoding: "utf8", timeout: 240_000 });
  if (r.status === 0) return null;
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, "").trim().split("\n").slice(-40).join("\n");
  return `${label} failed:\n${out}`;
};

const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs");
const failures = [
  ...["tsconfig.server.json", "tsconfig.client.json", "tsconfig.e2e.json"].map(p => run(`Type check (${p})`, [tsc, "-p", p])),
  run("Fast tests", [vitest, "run", "-c", "vitest.fast.config.ts"]),
].filter(Boolean);

if (failures.length) {
  console.error(`Fix these before finishing:\n\n${failures.join("\n\n")}`);
  process.exit(2);
}
if (now) {
  mkdirSync(path.dirname(stampFile), { recursive: true });
  writeFileSync(stampFile, now);
}
process.exit(0);
