import type pg from "pg";
import type { Candidate, DraftLine, ExtractedMedicine } from "../../../shared/extraction";

/**
 * Turns spoken or extracted prescription text into draft prescription lines. Matching is
 * deterministic: parsing rules for dose, route, frequency and duration, and pg_trgm similarity
 * against the tenant's catalogue. Nothing here saves anything. Whatever cannot be matched is
 * returned flagged for manual entry.
 */
export type { Candidate, DraftLine };

const STOP = new Set(("the a an and or of to for with give gave please then also take takes taken tablet tablets tab tabs capsule capsules " +
  "twice once thrice daily day days week weeks month months every hours hour mg ml mcg for by mouth oral orally dose doses after before " +
  "food morning night evening continue start stop dog cat patient need needs needed per at in on is are was be will can may it this that " +
  "milligram milligrams gram grams millilitre millilitres one two three four five six seven eight nine ten half fifty").split(" "));

const NUMBER_WORDS: Record<string, number> = {
  half: 0.5, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fourteen: 14,
};
const NUM = "\\d+(?:\\.\\d+)?|half|one|two|three|four|five|six|seven|eight|nine|ten";
export const numberOf = (s: string): number | null => {
  const t = s.toLowerCase();
  if (t in NUMBER_WORDS) return NUMBER_WORDS[t];
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const STRENGTH = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(mg\\/kg|milligrams?|mg|micrograms?|mcg|grams?|g|millilitres?|milliliters?|ml|iu|units?)\\b`, "i");
const COUNT = new RegExp(`(${NUM})\\s*(?:a\\s+)?(tablets?|tabs?|capsules?|drops?)\\b`, "i");
const FREQ: Array<[RegExp, string]> = [
  [/\b(once|one time|1 time)\s+(a day|daily|per day)\b|\bsid\b|\bonce daily\b/i, "once daily"],
  [/\b(twice|two times|2 times)\s*(a day|daily|per day)?\b|\bbid\b/i, "twice daily"],
  [/\b(thrice|three times|3 times)\s*(a day|daily|per day)?\b|\btid\b/i, "three times daily"],
  [/\b(four times|4 times)\s*(a day|daily)?\b|\bqid\b/i, "four times daily"],
  [/\bat night\b|\bnightly\b/i, "at night"],
  [/\bdaily\b|\bevery day\b|\bper day\b/i, "daily"],
];
const EVERY_HOURS = /\bevery\s+(\d+|six|eight|twelve|twenty four)\s+hours?\b/i;
const DURATION = new RegExp(`\\bfor\\s+(?:the next\\s+)?(\\d+|one|two|three|four|five|six|seven|ten|fourteen)\\s*(day|days|week|weeks|month|months)\\b|^\\s*(\\d+|one|two|three|four|five|six|seven|ten|fourteen)\\s*(day|days|week|weeks|month|months)\\s*$`, "i");
const ROUTES: Array<[RegExp, string]> = [
  [/\b(orally|by mouth|oral|per os|po)\b/i, "oral"],
  [/\b(intravenous(?:ly)?|iv)\b/i, "intravenous"],
  [/\b(intramuscular(?:ly)?|im)\b/i, "intramuscular"],
  [/\b(subcutaneous(?:ly)?|sc|subcut)\b/i, "subcutaneous"],
  [/\b(topical(?:ly)?|apply|ointment|cream)\b/i, "topical"],
  [/\b(eye drops?|ophthalmic)\b/i, "ophthalmic"],
  [/\b(ear drops?|otic)\b/i, "otic"],
];
const PER_DAY: Record<string, number> = { "once daily": 1, daily: 1, "twice daily": 2, "three times daily": 3, "four times daily": 4, "at night": 1 };

export function parseFrequency(text: string): string | null {
  for (const [re, label] of FREQ) if (re.test(text)) return label;
  const h = EVERY_HOURS.exec(text);
  return h ? `every ${h[1]} hours` : null;
}
export function parseDuration(text: string): { label: string; days: number } | null {
  const m = DURATION.exec(text);
  if (!m) return null;
  const n = numberOf(m[1] ?? m[3]);
  const unit = (m[2] ?? m[4]).toLowerCase();
  if (n == null) return null;
  return { label: `${m[1] ?? m[3]} ${unit}`.toLowerCase(), days: /week/.test(unit) ? n * 7 : /month/.test(unit) ? n * 30 : n };
}
export function parseCount(text: string): { value: number; unit: string; label: string } | null {
  const m = COUNT.exec(text);
  if (!m) return null;
  const v = numberOf(m[1]);
  return v == null ? null : { value: v, unit: m[2].toLowerCase().replace(/s$/, ""), label: `${m[1]} ${m[2]}`.toLowerCase() };
}
export function parseStrength(text: string): { value: number; label: string } | null {
  const m = STRENGTH.exec(text);
  return m ? { value: Number(m[1]), label: `${m[1]} ${m[2]}`.toLowerCase() } : null;
}
export function parseRoute(text: string): string | null {
  for (const [re, label] of ROUTES) if (re.test(text)) return label;
  return null;
}

const tokenise = (text: string) => text.toLowerCase().replace(/[^a-z0-9./\s-]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);

/** Catalogue items similar to each phrase, best first. */
async function findCandidates(c: pg.PoolClient, phrases: string[], minScore: number): Promise<Map<string, Candidate[]>> {
  const out = new Map<string, Candidate[]>();
  if (!phrases.length) return out;
  const rows = (await c.query(
    `select g.ngram, i.id, i.generic_name, i.strength, i.unit,
            greatest(similarity(i.generic_name, g.ngram), similarity(coalesce(i.brand_name,''), g.ngram))::float score
       from unnest($1::text[]) as g(ngram)
       join lateral (select * from items where active and (generic_name % g.ngram or brand_name % g.ngram)) i on true`, [phrases])).rows;
  for (const r of rows) {
    if (r.score < minScore) continue;
    const list = out.get(r.ngram) ?? [];
    list.push({ itemId: r.id, name: r.generic_name, strength: r.strength, unit: r.unit, score: Number(r.score.toFixed(3)) });
    out.set(r.ngram, list);
  }
  for (const list of out.values()) list.sort((a, b) => b.score - a.score);
  return out;
}

/** When several strengths match, prefer the one that matches the spoken strength. */
function narrow(candidates: Candidate[], strength: number | null): Candidate[] {
  if (strength == null || candidates.length < 2) return candidates;
  const exact = candidates.filter(x => x.strength && new RegExp(`(^|\\D)${strength}\\s*(mg|mcg|g|ml|iu)`, "i").test(x.strength));
  return exact.length === 1 ? exact : candidates;
}

function quantityFor(count: ReturnType<typeof parseCount>, frequency: string | null, duration: ReturnType<typeof parseDuration>, unit: string | null) {
  if (!count || !frequency || !duration || !unit || !unit.toLowerCase().startsWith(count.unit.slice(0, 3))) return null;
  const perDay = PER_DAY[frequency];
  return perDay ? Math.ceil(count.value * perDay * duration.days) : null;
}

function buildLine(word: string, candidates: Candidate[], p: { dose: string | null; route: string | null; frequency: string | null; duration: string | null; instructions: string | null; strengthNum: number | null; countText: string; durationText: string; freqText: string }): DraftLine {
  const cands = narrow(candidates, p.strengthNum);
  const only = cands.length === 1 ? cands[0] : null;
  const reason = only ? null : cands.length > 1 ? "More than one catalogue item matches. Choose the right strength." : "Not found in the catalogue. Choose an item or enter it by hand.";
  const count = parseCount(p.countText);
  const dur = parseDuration(p.durationText);
  return {
    drugText: word, itemId: only?.itemId ?? null, itemName: only?.name ?? null, matchScore: cands[0]?.score ?? null, candidates: cands,
    dose: p.dose, route: p.route, frequency: p.frequency, duration: p.duration, instructions: p.instructions,
    quantity: quantityFor(count, parseFrequency(p.freqText) ?? p.frequency, dur, only?.unit ?? null), unmatched: !only, reason,
  };
}

type Hit = { start: number; end: number; phrase: string };

/** Draft lines from a free-text transcript. */
export async function structureTranscript(c: pg.PoolClient, transcript: string, minScore = 0.5): Promise<{ lines: DraftLine[]; ignoredText: string }> {
  const tokens = tokenise(transcript);
  const spans: Array<Hit & { variants: string[] }> = [];
  for (let n = 3; n >= 1; n--) {
    for (let i = 0; i + n <= tokens.length; i++) {
      const slice = tokens.slice(i, i + n);
      if (slice.some(t => /^\d/.test(t) || STOP.has(t))) continue;
      const joined = slice.join("");
      // A single word needs 4+ letters. A phrase can contain short pieces when joined it is long enough ("car pro fn").
      if (n === 1 ? slice[0].length < 4 : joined.length < 6) continue;
      spans.push({ start: i, end: i + n, phrase: slice.join(" "), variants: n === 1 ? [slice[0]] : [slice.join(" "), joined] });
    }
  }
  const found = await findCandidates(c, [...new Set(spans.flatMap(s => s.variants))], minScore);
  const scored = spans.map(s => {
    const merged = new Map<string, Candidate>();
    for (const v of s.variants) for (const cand of found.get(v) ?? []) {
      const prev = merged.get(cand.itemId);
      if (!prev || cand.score > prev.score) merged.set(cand.itemId, cand);
    }
    return { ...s, cands: [...merged.values()].sort((a, b) => b.score - a.score) };
  }).filter(s => s.cands.length);

  // Choose non-overlapping mentions: the best score wins, ties go to the longer phrase.
  scored.sort((a, b) => b.cands[0].score - a.cands[0].score || (b.end - b.start) - (a.end - a.start));
  const chosen: typeof scored = [];
  for (const s of scored) if (!chosen.some(x => s.start < x.end && s.end > x.start)) chosen.push(s);

  // A drug the catalogue does not hold still shows up as "<word> <number> mg". Keep it for manual entry.
  const unknown: Array<{ start: number; end: number; word: string }> = [];
  for (let i = 0; i + 2 < tokens.length; i++) {
    if (/^[a-z]{4,}$/.test(tokens[i]) && !STOP.has(tokens[i]) && /^\d+(\.\d+)?$/.test(tokens[i + 1]) && /^(mg|mcg|ml|g|iu)$/.test(tokens[i + 2])
        && !chosen.some(x => i < x.end && i + 1 > x.start)) unknown.push({ start: i, end: i + 1, word: tokens[i] });
  }
  const mentions = [
    ...chosen.map(s => ({ start: s.start, end: s.end, word: s.phrase, cands: s.cands })),
    ...unknown.map(u => ({ start: u.start, end: u.end, word: u.word, cands: [] as Candidate[] })),
  ].sort((a, b) => a.start - b.start);

  const lines = mentions.map((m, idx) => {
    const next = mentions[idx + 1];
    const clause = tokens.slice(m.end, next ? next.start : tokens.length).join(" ");
    const around = `${tokens.slice(Math.max(0, m.start - 3), m.start).join(" ")} ${clause}`;
    const strength = parseStrength(clause) ?? parseStrength(around);
    const count = parseCount(clause) ?? parseCount(around);
    const dur = parseDuration(clause);
    return buildLine(m.word, m.cands, {
      dose: count ? count.label : strength ? strength.label : null, route: parseRoute(clause), frequency: parseFrequency(clause),
      duration: dur?.label ?? null, instructions: null, strengthNum: strength?.value ?? null,
      countText: count ? count.label : "", durationText: dur ? `for ${dur.label}` : "", freqText: clause,
    });
  });

  const used = new Set<number>();
  for (const m of mentions) for (let i = m.start; i < m.end; i++) used.add(i);
  return { lines, ignoredText: tokens.filter((_, i) => !used.has(i)).join(" ") };
}

/** Draft lines from medicines already extracted by the language model: only the catalogue matching happens here. */
export async function matchMedicines(c: pg.PoolClient, meds: ExtractedMedicine[], minScore = 0.5): Promise<DraftLine[]> {
  const variants = (name: string) => {
    const t = tokenise(name).filter(x => !STOP.has(x) || x.length > 4);
    const phrase = t.join(" ");
    return phrase ? [...new Set([phrase, t.join("")])] : [];
  };
  const found = await findCandidates(c, [...new Set(meds.flatMap(m => variants(m.name)))], minScore);
  return meds.map(m => {
    const merged = new Map<string, Candidate>();
    for (const v of variants(m.name)) for (const cand of found.get(v) ?? []) {
      const prev = merged.get(cand.itemId);
      if (!prev || cand.score > prev.score) merged.set(cand.itemId, cand);
    }
    const cands = [...merged.values()].sort((a, b) => b.score - a.score);
    const all = `${m.strength} ${m.dosage}`;
    const strength = parseStrength(all);
    const count = parseCount(m.dosage);
    return buildLine(m.name, cands, {
      dose: m.dosage || null, route: m.route || parseRoute(m.instructions) || null, frequency: m.frequency || null,
      duration: m.duration || null, instructions: m.instructions || null, strengthNum: strength?.value ?? null,
      countText: count ? count.label : "", durationText: m.duration ? `for ${m.duration}` : "", freqText: m.frequency,
    });
  });
}
