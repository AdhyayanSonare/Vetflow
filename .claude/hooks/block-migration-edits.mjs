// PreToolUse hook: applied migrations are immutable (their checksums are recorded in every database).
// A migration counts as applied once it is tracked by git. New, untracked files are allowed.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const file = input.tool_input?.file_path;
if (!file) process.exit(0);

const root = input.cwd ?? process.cwd();
const rel = path.relative(root, path.resolve(root, file)).split(path.sep).join("/");
if (!/^db\/migrations\/\d{4}_[^/]*\.sql$/.test(rel)) process.exit(0);

let tracked = false;
try {
  execFileSync("git", ["ls-files", "--error-unmatch", rel], { cwd: root, stdio: "ignore" });
  tracked = true;
} catch {
  // not tracked: a new migration being written
}
if (!tracked) process.exit(0);

console.error(
  `${rel} is already committed, so it may already be applied to a database and its checksum is recorded. ` +
    "Applied migrations are immutable. Add a new numbered file in db/migrations/ that fixes forward instead.",
);
process.exit(2);
