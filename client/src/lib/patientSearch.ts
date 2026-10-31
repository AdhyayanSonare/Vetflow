export type SearchablePatient = { name: string; owner: string; id: string; phone: string; species: string; breed: string };

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const digits = (text: string) => text.replace(/\D/g, "");

/**
 * Finds patients by name, owner, ID, phone, species or breed. Every word typed must match
 * somewhere (so "bruno rahul" finds Bruno owned by Rahul); accents and case are ignored and
 * phone numbers match regardless of spaces or dashes. Results are ordered by how well the
 * name matches, then by how well the owner matches, keeping the original order within ties.
 */
export function searchPatients<T extends SearchablePatient>(patients: T[], query: string, limit = Infinity): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return patients.slice(0, limit);

  const scored: { patient: T; score: number; index: number }[] = [];
  patients.forEach((patient, index) => {
    const name = fold(patient.name);
    const owner = fold(patient.owner);
    const haystack = [name, owner, fold(patient.id), fold(patient.species), fold(patient.breed), fold(patient.phone)].join(" ");
    const phoneDigits = digits(patient.phone);
    const matches = words.every(word => haystack.includes(word) || (digits(word).length >= 3 && digits(word) === word.replace(/[\s-]/g, "") && phoneDigits.includes(digits(word))));
    if (!matches) return;
    const first = words[0];
    const score = name.startsWith(first) ? 0 : name.split(/\s+/).some(part => part.startsWith(first)) ? 1 : owner.split(/\s+/).some(part => part.startsWith(first)) ? 2 : 3;
    scored.push({ patient, score, index });
  });
  scored.sort((a, b) => a.score - b.score || a.index - b.index);
  return scored.slice(0, limit).map(entry => entry.patient);
}
