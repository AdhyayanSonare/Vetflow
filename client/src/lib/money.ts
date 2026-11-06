/**
 * Money is stored as integer paise. People type rupees. These two functions are the only place
 * the conversion happens, so a price can never drift through floating-point arithmetic.
 */

/** "12.50", "1,250" or "₹ 99" to paise, or null if it is not a valid non-negative amount with at most two decimals. */
export function parseRupees(input: string): number | null {
  const s = input.replace(/[₹\s,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

/** Paise to the text shown in an input: 1250 becomes "12.5". Empty for zero or missing, so the field starts blank. */
export function rupeesText(paise: number | null | undefined): string {
  if (!paise) return "";
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  return rest === 0 ? String(rupees) : `${rupees}.${String(rest).padStart(2, "0").replace(/0$/, "")}`;
}
