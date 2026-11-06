/**
 * Display formatting. Money is stored as integer paise and shown in rupees with Indian digit grouping.
 * Dates are stored in UTC and shown in India time (Asia/Kolkata).
 */
const IST = "Asia/Kolkata";

export function money(paise: number | null | undefined, decimals: 0 | 2 = 2): string {
  if (paise === null || paise === undefined || Number.isNaN(paise)) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(paise / 100);
}

/** A quantity with up to three decimals, without trailing zeros: 12, 2.5, 0.125. */
export function qty(n: number | null | undefined, unit?: string | null): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const text = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(n);
  return unit ? `${text} ${unit}` : text;
}

export const count = (n: number | null | undefined) => (n == null ? "—" : new Intl.NumberFormat("en-IN").format(n));

type DateInput = string | Date | null | undefined;
const toDate = (v: DateInput): Date | null => {
  if (!v) return null;
  // A plain calendar date (an expiry) has no time zone, so it is shown as is.
  const d = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00+05:30`) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function dateIST(v: DateInput): string {
  const d = toDate(v);
  return d ? new Intl.DateTimeFormat("en-IN", { timeZone: IST, day: "numeric", month: "short", year: "numeric" }).format(d) : "—";
}
export function dateShortIST(v: DateInput): string {
  const d = toDate(v);
  return d ? new Intl.DateTimeFormat("en-IN", { timeZone: IST, day: "numeric", month: "short" }).format(d) : "—";
}
export function timeIST(v: DateInput): string {
  const d = toDate(v);
  return d ? new Intl.DateTimeFormat("en-IN", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: false }).format(d) : "—";
}
export function dateTimeIST(v: DateInput): string {
  const d = toDate(v);
  return d ? `${dateIST(d)}, ${timeIST(d)}` : "—";
}

/** Today's calendar date in India as YYYY-MM-DD. */
export function todayIST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysUntil(date: string, today: string = todayIST()): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export type Tone = "ok" | "warn" | "danger" | "neutral";

/** How to describe a batch's expiry: the wording and the tone to colour it. */
export function expiryStatus(expiryDate: string, today: string = todayIST(), warnDays = 90): { days: number; label: string; tone: Tone } {
  const days = daysUntil(expiryDate, today);
  if (days < 0) return { days, label: `Expired ${-days} ${-days === 1 ? "day" : "days"} ago`, tone: "danger" };
  if (days === 0) return { days, label: "Expires today", tone: "danger" };
  if (days <= 30) return { days, label: `${days} ${days === 1 ? "day" : "days"} left`, tone: "danger" };
  if (days <= warnDays) return { days, label: `${days} days left`, tone: "warn" };
  return { days, label: dateIST(expiryDate), tone: "neutral" };
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join("");

export const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

/** Age from a date of birth, in the largest sensible unit: "4 yr", "7 mo", "3 wk". */
export function ageFrom(dob: string | null | undefined, today: string = todayIST()): string {
  if (!dob) return "";
  const days = -daysUntil(dob, today);
  if (days < 0) return "";
  if (days < 14) return `${Math.max(days, 0)} d`;
  if (days < 60) return `${Math.floor(days / 7)} wk`;
  if (days < 730) return `${Math.floor(days / 30.4)} mo`;
  return `${Math.floor(days / 365.25)} yr`;
}
