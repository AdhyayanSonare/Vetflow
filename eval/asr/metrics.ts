/**
 * Scoring for the speech evaluation. Pure functions, no I/O, so they are unit-tested
 * (tests/unit/eval-metrics.test.ts) and the numbers they produce can be trusted.
 */

/** Lower-case, drop punctuation, keep letters and digits in any script (Devanagari included). */
export function normalise(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s'-]/gu, " ")
    .replace(/['-]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

/** Word-level edit distance (substitutions, insertions, deletions). */
function editDistance(a: string[], b: string[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export type Wer = { errors: number; refWords: number };

/** Errors and reference length for one clip. Add these up across clips, then divide, for a corpus rate. */
export function wordErrors(reference: string, hypothesis: string): Wer {
  const ref = normalise(reference);
  return { errors: editDistance(ref, normalise(hypothesis)), refWords: ref.length };
}

export const rate = (w: Wer): number | null => (w.refWords === 0 ? null : w.errors / w.refWords);

export type DrugHits = { expected: string[]; found: string[]; missed: string[] };

/**
 * Which of the listed drug names does the reference say, and which of those reappear in the
 * hypothesis? Compared as whole word sequences, so "amoxicillin" does not hit inside "amoxicillins".
 */
export function drugHits(reference: string, hypothesis: string, drugs: string[]): DrugHits {
  const ref = ` ${normalise(reference).join(" ")} `;
  const hyp = ` ${normalise(hypothesis).join(" ")} `;
  const expected: string[] = [];
  const found: string[] = [];
  for (const drug of drugs) {
    const key = ` ${normalise(drug).join(" ")} `;
    if (key.trim() === "" || !ref.includes(key)) continue;
    expected.push(drug);
    if (hyp.includes(key)) found.push(drug);
  }
  return { expected, found, missed: expected.filter(d => !found.includes(d)) };
}
