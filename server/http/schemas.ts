import { z } from "zod";

/** Request-body building blocks shared by every module. */
export const uuid = z.string().uuid();
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
/** A positive quantity, up to a million units. */
export const qtyNum = z.coerce.number().positive().max(1_000_000);
export const qty = qtyNum;
/** Money in integer paise. */
export const paise = z.coerce.number().int().min(0).max(100_000_000_00);
export const reasonText = z.string().trim().min(3, "A reason is required").max(300);
/** An optional, trimmed free-text field with a length limit. */
export const text = (max = 500) => z.string().trim().max(max).nullish();
