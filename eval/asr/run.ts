import "dotenv/config";
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { AUDIO_EXTENSION_MIME } from "../../shared/voice";
import { localAsrClient, groqAsrClient, type AsrClient } from "../../server/modules/voice/asr";
import { getConfig } from "../../server/config/env";
import { drugHits, rate, wordErrors, type Wer } from "./metrics";

/**
 * Speech evaluation. Reads real clips and their reference text, runs each configured provider,
 * and prints word error rate and drug-name hit rate. It refuses to print numbers without clips.
 *
 *   pnpm eval:asr                       # clips in eval/asr/clips, providers from .env
 *   pnpm eval:asr --provider local --language hi
 *
 * Layout: clips/<name>.wav (or mp3, m4a, webm, ogg, flac), <name>.txt = what was actually said,
 * optional <name>.lang (en, hi, ...). drugs.txt = one drug name per line (see drugs.example.txt).
 */
const { values } = parseArgs({
  options: {
    dir: { type: "string", default: path.join(import.meta.dirname, "clips") },
    drugs: { type: "string", default: path.join(import.meta.dirname, "drugs.txt") },
    provider: { type: "string", default: "all" },
    language: { type: "string", default: "en" },
  },
});

const exts = new Set(Object.keys(AUDIO_EXTENSION_MIME));
const clips = existsSync(values.dir!)
  ? readdirSync(values.dir!).filter(f => exts.has(path.extname(f).slice(1).toLowerCase()) && existsSync(path.join(values.dir!, `${path.parse(f).name}.txt`)))
  : [];
if (clips.length === 0) {
  console.error(
    `No clips found in ${values.dir}.\n` +
      "Add recordings of real consultations as <name>.wav with the exact words spoken in <name>.txt (see eval/asr/README.md).\n" +
      "No figures are printed without them: invented numbers are worse than none.",
  );
  process.exit(2);
}
const drugs = existsSync(values.drugs!) ? readFileSync(values.drugs!, "utf8").split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith("#")) : [];
if (drugs.length === 0) console.warn(`No drug list at ${values.drugs}; drug-name hit rate will be skipped.`);

const config = getConfig();
const providers: Array<{ name: string; client: AsrClient }> = [];
if (["all", "groq"].includes(values.provider!) && config.groq.apiKey) providers.push({ name: `groq:${config.groq.transcribeModel}`, client: groqAsrClient(config.groq) });
if (["all", "local"].includes(values.provider!) && config.asr.localUrl) providers.push({ name: "local", client: localAsrClient(config.asr.localUrl) });
if (providers.length === 0) {
  console.error("No provider is configured. Set GROQ_API_KEY and/or ASR_URL in .env (see .env.example).");
  process.exit(2);
}

type Row = { provider: string; language: string; wer: Wer; expected: number; found: number; clips: number; failed: number; seconds: number };
const rows = new Map<string, Row>();

for (const p of providers) {
  for (const file of clips) {
    const name = path.parse(file).name;
    const reference = readFileSync(path.join(values.dir!, `${name}.txt`), "utf8");
    const langFile = path.join(values.dir!, `${name}.lang`);
    const language = existsSync(langFile) ? readFileSync(langFile, "utf8").trim() : values.language!;
    const key = `${p.name}|${language}`;
    const row = rows.get(key) ?? { provider: p.name, language, wer: { errors: 0, refWords: 0 }, expected: 0, found: 0, clips: 0, failed: 0, seconds: 0 };
    rows.set(key, row);
    const started = Date.now();
    try {
      const out = await p.client(readFileSync(path.join(values.dir!, file)), AUDIO_EXTENSION_MIME[path.extname(file).slice(1).toLowerCase()], language);
      const w = wordErrors(reference, out.text);
      const d = drugHits(reference, out.text, drugs);
      row.wer.errors += w.errors; row.wer.refWords += w.refWords;
      row.expected += d.expected.length; row.found += d.found.length;
      row.clips += 1;
      row.seconds += (Date.now() - started) / 1000;
    } catch (e) {
      row.failed += 1;
      console.error(`  ${p.name} failed on ${file}: ${(e as Error).message}`);
    }
  }
}

const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);
console.log(`\n${"provider".padEnd(28)} ${"lang".padEnd(5)} ${"clips".padEnd(6)} ${"WER".padEnd(8)} ${"drug names".padEnd(18)} sec/clip`);
const table = [...rows.values()].map(r => ({
  provider: r.provider, language: r.language, clips: r.clips, failed: r.failed,
  wordErrorRate: rate(r.wer), drugNamesExpected: r.expected, drugNamesFound: r.found,
  drugNameHitRate: r.expected ? r.found / r.expected : null, secondsPerClip: r.clips ? r.seconds / r.clips : null,
}));
for (const t of table) {
  console.log(`${t.provider.padEnd(28)} ${t.language.padEnd(5)} ${String(t.clips).padEnd(6)} ${pct(t.wordErrorRate).padEnd(8)} ${`${pct(t.drugNameHitRate)} (${t.drugNamesFound}/${t.drugNamesExpected})`.padEnd(18)} ${t.secondsPerClip?.toFixed(2) ?? "n/a"}${t.failed ? `  (${t.failed} failed)` : ""}`);
}
const outDir = path.join(import.meta.dirname, "results");
mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `${new Date().toISOString().slice(0, 10)}.json`);
writeFileSync(file, JSON.stringify({ ran: new Date().toISOString(), clips: clips.length, results: table }, null, 2));
console.log(`\nSaved ${file}. Copy the table into docs/PROGRESS.md only from a real run.`);
