// PostToolUse hook: run ESLint with --fix on the file that was just edited and report what is left.
// Only .ts/.tsx files inside the project are checked. Prettier is not run: the code base is not
// Prettier-formatted, and reformatting whole files on every edit would bury real changes in noise.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const file = input.tool_input?.file_path ?? input.tool_response?.filePath;
if (!file || !/\.(ts|tsx)$/.test(file)) process.exit(0);

const root = input.cwd ?? process.cwd();
const abs = path.resolve(root, file);
const rel = path.relative(root, abs);
if (rel.startsWith("..") || path.isAbsolute(rel) || !existsSync(abs)) process.exit(0);

const eslint = path.join(root, "node_modules", "eslint", "bin", "eslint.js");
if (!existsSync(eslint)) process.exit(0); // dependencies not installed yet

const r = spawnSync(process.execPath, [eslint, "--fix", "--no-warn-ignored", rel], { cwd: root, encoding: "utf8", timeout: 60_000 });
if (r.status === 0) process.exit(0);

console.error(`ESLint found problems in ${rel} that it could not fix:\n${(r.stdout + r.stderr).trim().slice(0, 3000)}`);
process.exit(2);
