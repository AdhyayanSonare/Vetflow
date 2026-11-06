import type pg from "pg";

/**
 * Turns a transcript into a draft prescription. Matching is deterministic: parsing rules for
 * dose, route, frequency and duration, and pg_trgm similarity against the tenant's catalogue.
 * Nothing here saves anything. Whatever cannot be matched is returned flagged for manual entry.
 */
export type DraftLine = {
  drugText: string;
  itemId: string | null;
  itemName: string | null;
  matchScore: number | null;
  candidates: Array<{ itemId: string; name: string; strength: string | null; unit: string; score: number }>;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  duration: string | null;
  quantity: number | null;
  unmatched: boolean;
  reason: string | null;
};

const STOP = new Set(("the a an and or of to for with give gave please then also take takes taken tablet tablets tab tabs capsule capsules " +
  "twice once thrice daily day days week weeks month months every hours hour mg ml mcg for by mouth oral orally dose doses after before " +
  "food morning night evening continue start stop dog cat patient bruno need needs needed per at in on is are was be will can may it this that").split(" "));

const NUMBER_WORDS: Record<string, number> = {
  half: 0.5, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fourteen: 14,
};
const numberOf = (s: string): number | null => {
  const t = s.toLowerCase();
  if (t in NUMBER_WORDS) return NUMBER_WORDS[t];
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const STRENGTH = /(\d+(?:\.\d+)?)\s*(mg\/kg|mg|mcg|micrograms?|g|grams?|ml|millilitres?|iu|units?)\b/i;
const COUNT = /(\d+(?:\.\d+)?|half|one|two|three|four|five)\s*(?:a\s+)?(tablets?|tabs?|capsules?|drops?)\b/i;
const FREQ_WORD: Array<[RegExp, string]> = [
  [/\b(once|one time|1 time)\s+(a day|daily|per day)\b|\bsid\b|\bonce daily\b/i, "once daily"],
  [/\b(twice|two times|2 times)\s*(a day|daily|per day)?\b|\bbid\b/i, "twice daily"],
  [/\b(thrice|three times|3 times)\s*(a day|daily|per day)?\b|\btid\b/i, "three times daily"],
  [/\b(four times|4 times)\s*(a day|daily)?\b|\bqid\b/i, "four times daily"],
  [/\bevery\s+(\d+|six|eight|twelve|twenty four)\s+hours?\b/i, ""],
  [/\bat night\b|\bnightly\b/i, "at night"],
  [/\bdaily\b|\bevery day\b/i, "daily"],
];
const DURATION = /\bfor\s+(?:the next\s+)?(\d+|one|two|three|four|five|six|seven|ten|fourteen)\s*(day|days|week|weeks|month|months)\b/i;
const ROUTES: Array<[RegExp, string]> = [
  [/\b(orally|by mouth|oral|per os)\b/i, "oral"],
  [/\b(intravenous(?:ly)?|iv)\b/i, "intravenous"],
  [/\b(intramuscular(?:ly)?|im)\b/i, "intramuscular"],
  [/\b(subcutaneous(?:ly)?|sc|subcut)\b/i, "subcutaneous"],
  [/\b(topical(?:ly)?|apply|ointment|cream)\b/i, "topical"],
  [/\b(eye drops?|ophthalmic)\b/i, "ophthalmic"],
  [/\b(ear drops?|otic)\b/i, "otic"],
];
const PER_DAY: Record<string, number> = { "once daily": 1, daily: 1, "twice daily": 2, "three times daily": 3, "four times daily": 4, "at night": 1 };

const tokenise = (text: string) => text.toLowerCase().replace(/[^a-z0-9./\s-]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);

type Hit = { start: number; end: number; ngram: string; items: Array<{ id: string; name: string; strength: string | null; unit: string; score: number }> };

export async function structureTranscript(c: pg.PoolClient, transcript: string, minScore = 0.5): Promise<{ lines: DraftLine[]; ignoredText: string }> {
  const tokens = tokenise(transcript);
  const grams: Array<{ start: number; end: number; text: string }> = [];
  for (let n = 3; n >= 1; n--) {
    for (let i = 0; i + n <= tokens.length; i++) {
      const slice = tokens.slice(i, i + n);
      if (slice.some(t => /^\d/.test(t) || STOP.has(t) || t.length < 4)) continue;
      grams.push({ start: i, end: i + n, text: slice.join(" ") });
    }
  }
  const uniq = [...new Set(grams.map(g => g.text))];
  const byGram = new Map<string, Hit["items"]>();
  if (uniq.length) {
    const rows = (await c.query(
      `select g.ngram, i.id, i.generic_name, i.brand_name, i.strength, i.unit,
              greatest(similarity(i.generic_name, g.ngram), similarity(coalesce(i.brand_name,''), g.ngram))::float score
         from unnest($1::text[]) as g(ngram)
         join lateral (select * from items where active and (generic_name % g.ngram or brand_name % g.ngram)) i on true`, [uniq])).rows;
    for (const r of rows) {
      if (r.score < minScore) continue;
      const list = byGram.get(r.ngram) ?? [];
      list.push({ id: r.id, name: r.generic_name, strength: r.strength, unit: r.unit, score: r.score });
      byGram.set(r.ngram, list);
    }
  }

  // Choose non-overlapping mentions: the best score wins, ties go to the longer phrase.
  const hits: Hit[] = grams.filter(g => byGram.has(g.text)).map(g => ({ start: g.start, end: g.end, ngram: g.text, items: byGram.get(g.text)! }));
  hits.sort((a, b) => Math.max(...b.items.map(x => x.score)) - Math.max(...a.items.map(x => x.score)) || (b.end - b.start) - (a.end - a.start));
  const chosen: Hit[] = [];
  for (const h of hits) if (!chosen.some(x => h.start < x.end && h.end > x.start)) chosen.push(h);
  chosen.sort((a, b) => a.start - b.start);

  // A drug the catalogue does not hold still shows up as "<word> <number> mg". Keep it for manual entry.
  const unknown: Array<{ start: number; end: number; word: string }> = [];
  for (let i = 0; i + 2 < tokens.length; i++) {
    if (/^[a-z]{4,}$/.test(tokens[i]) && !STOP.has(tokens[i]) && /^\d+(\.\d+)?$/.test(tokens[i + 1]) && /^(mg|mcg|ml|g|iu)$/.test(tokens[i + 2])
        && !chosen.some(x => i < x.end && i + 1 > x.start)) {
      unknown.push({ start: i, end: i + 1, word: tokens[i] });
    }
  }

  const mentions = [
    ...chosen.map(h => ({ start: h.start, end: h.end, hit: h as Hit | null, word: h.ngram })),
    ...unknown.map(u => ({ start: u.start, end: u.end, hit: null as Hit | null, word: u.word })),
  ].sort((a, b) => a.start - b.start);

  const lines: DraftLine[] = mentions.map((m, idx) => {
    const next = mentions[idx + 1];
    const clause = tokens.slice(m.end, next ? next.start : tokens.length).join(" ");
    const around = `${tokens.slice(Math.max(0, m.start - 3), m.start).join(" ")} ${clause}`;
    const strengthM = STRENGTH.exec(clause) ?? STRENGTH.exec(around);
    const strengthNum = strengthM ? Number(strengthM[1]) : null;
    const countM = COUNT.exec(clause) ?? COUNT.exec(around);
    const countNum = countM ? numberOf(countM[1]) : null;
    const countUnit = countM ? countM[2].toLowerCase().replace(/s$/, "") : null;
    // What is shown as the dose: the count if one was spoken ("1 tablet"), otherwise the strength or volume.
    const dose = countM ? `${countM[1]} ${countM[2]}`.toLowerCase() : strengthM ? `${strengthM[1]} ${strengthM[2]}`.toLowerCase() : null;

    let frequency: string | null = null;
    for (const [re, label] of FREQ_WORD) {
      const f = re.exec(clause);
      if (f) { frequency = label || `every ${f[1]} hours`; break; }
    }
    const dur = DURATION.exec(clause);
    const durN = dur ? numberOf(dur[1]) : null;
    const duration = dur ? `${dur[1]} ${dur[2]}`.toLowerCase() : null;
    let route: string | null = null;
    for (const [re, label] of ROUTES) if (re.test(clause)) { route = label; break; }

    // Candidates: same generic name, ranked by whether the spoken dose matches the strength.
    let candidates: DraftLine["candidates"] = [];
    if (m.hit) {
      candidates = m.hit.items.map(x => ({ itemId: x.id, name: x.name, strength: x.strength, unit: x.unit, score: Number(x.score.toFixed(3)) }));
      if (strengthNum != null && candidates.length > 1) {
        const exact = candidates.filter(x => x.strength && new RegExp(`(^|\\D)${strengthNum}\\s*(mg|mcg|g|ml|iu)`, "i").test(x.strength));
        if (exact.length === 1) candidates = exact;
      }
    }
    let itemId: string | null = null; let itemName: string | null = null; let reason: string | null = null;
    if (candidates.length === 1) { itemId = candidates[0].itemId; itemName = candidates[0].name; }
    else if (candidates.length > 1) reason = "More than one catalogue item matches. Choose the right strength.";
    else reason = "Not found in the catalogue. Choose an item or enter it by hand.";

    // Quantity is worked out only when the dose is a count in the same unit as the stock unit.
    let quantity: number | null = null;
    const stockUnit = candidates.length === 1 ? candidates[0].unit.toLowerCase() : null;
    if (countNum && countUnit && frequency && durN && stockUnit && stockUnit.startsWith(countUnit.slice(0, 3))) {
      const perDay = PER_DAY[frequency];
      const days = /week/.test(duration ?? "") ? durN * 7 : /month/.test(duration ?? "") ? durN * 30 : durN;
      if (perDay) quantity = Math.ceil(countNum * perDay * days);
    }
    return {
      drugText: m.word, itemId, itemName, matchScore: candidates[0]?.score ?? null, candidates, dose, route, frequency, duration, quantity,
      unmatched: !itemId, reason,
    };
  });

  const used = new Set<number>();
  for (const m of mentions) for (let i = m.start; i < m.end; i++) used.add(i);
  return { lines, ignoredText: tokens.filter((_, i) => !used.has(i)).join(" ") };
}
