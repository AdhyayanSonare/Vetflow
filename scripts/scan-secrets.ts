import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Looks for things that must never be committed: private keys, API keys, tokens, and passwords inside
 * connection strings. Scans files tracked by git. Placeholders such as <PASSWORD> and the documented
 * synthetic demo values are allowed.
 */
export type Hit = { file: string; line: number; rule: string };

const RULES: Array<{ name: string; re: RegExp }> = [
  { name: "private key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: "Groq API key", re: /\bgsk_[A-Za-z0-9]{20,}\b/ },
  { name: "OpenAI-style API key", re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "JSON web token", re: /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\b/ },
  // user:password@host where the password is a real-looking value, not a placeholder or a documented local value
  { name: "password in a connection string", re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:@/<>"'`]+:(?!<)(?!\$\{)(?!\$)(?!\*+)(?!x+@)([^\s@/<>"'`]{6,})@(?!localhost|127\.0\.0\.1|postgres[:/]|host\b|example)/i },
];

const SKIP_FILES = /(^|\/)(pnpm-lock\.yaml|\.env\.example|certs\/.*\.crt)$|\.(png|jpg|jpeg|webp|gif|ico|woff2?|xlsx|zip)$/i;
/** Lines that carry deliberate, harmless fixtures (tests of this very scanner). */
const ALLOW_LINE = /secret-scan:allow/;

export function scanText(file: string, text: string): Hit[] {
  const hits: Hit[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (ALLOW_LINE.test(line)) return;
    for (const r of RULES) if (r.re.test(line)) hits.push({ file, line: i + 1, rule: r.name });
  });
  return hits;
}

if (process.argv[1] && /scan-secrets\.(ts|js)$/.test(process.argv[1])) {
  const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(f => f && !SKIP_FILES.test(f));
  const hits: Hit[] = [];
  for (const f of files) {
    let text: string;
    try { text = readFileSync(f, "utf8"); } catch { continue; }
    if (text.includes("\u0000")) continue;
    hits.push(...scanText(f, text));
  }
  if (hits.length) {
    console.error(`Secret scan failed: ${hits.length} possible secret(s).`);
    for (const h of hits) console.error(`  ${h.file}:${h.line}  ${h.rule}`);
    process.exit(1);
  }
  console.log(`Secret scan passed: ${files.length} tracked files checked.`);
}
