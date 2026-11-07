---
name: ledger-invariants
description: Rules for anything that changes stock quantities in Vetflow (receipts, issues, dispensing, transfers, counts, adjustments, vials, returns). Use before writing or reviewing code or SQL that touches stock_ledger, stock_balances, batches or apply_stock_movement.
---

# Ledger invariants

Stock is a ledger, not a number. Breaking these rules corrupts a clinic's medicine records, so check every change against them.

## The rules

1. **One writer.** Quantities change only through the SQL function `apply_stock_movement` (called by `postMovement` in `server/modules/stock/ledger.ts`). It inserts one ledger row and updates the balance in the same transaction. Never `insert`/`update` `stock_balances` or `stock_ledger` from application code or a migration. The app role has no right to; keep it that way.
2. **Append-only.** No `update` or `delete` on the ledger or audit log, ever. A mistake is corrected with a new movement (count adjustment, reversing entry) that carries a reason. Do not add a "void" that mutates rows.
3. **Idempotent.** Every movement carries an `idempotencyKey`. A retry with the same key returns the original ledger id and changes nothing. New endpoints must accept an `Idempotency-Key` header or generate one per logical action, never per retry.
4. **Never negative** unless all of: the tenant setting `allow_negative_override` is on, the user is admin or inventory manager (`stock.override`), and a reason is given. The override is audited.
5. **Expired batches** cannot be issued or dispensed (`expiry_date < today_ist()`); only a write-off moves them out. Dates are India dates: use `today_ist()`, never `now()::date`.
6. **FEFO.** Plans allocate earliest expiry first, then oldest, skipping empty and expired batches (`issueFefo`). A caller may not pick a later batch to dodge an expiry.
7. **Every row says why.** Type, who, when, reason (required for adjustments, write-offs, returns, overrides), and a reference to the document that caused it (receipt, dispense, transfer, count).
8. **Balance = sum of ledger.** `ledger_balances` (view) and `reconcile_balances()` must agree with `stock_balances`. The nightly job reports any difference. If you add a movement type, update both.
9. **Transfers go through transit.** `transfer_out` to the in-transit store, `transfer_in` on receipt; a short delivery leaves the difference visible, not deleted.
10. **Draft vs posted.** A receipt adds stock only on confirm; an approved prescription alone removes nothing; only a confirmed dispense does.

## Money

Integer paise everywhere (`unit_cost_paise`). Valuation uses each batch's own cost. Convert at the screen edge with `lib/money.ts` (`parseRupees`, `rupeesText`); never store floats.

## Tests to add or extend

- `tests/db/ledger.test.ts`: property tests (fast-check) for balance = sum, no negative, idempotent replay, concurrent issues of the last unit (exactly one succeeds).
- `tests/api/stock-operations.test.ts`, `clinical-dispensing.test.ts`: the HTTP paths, permissions, expired and insufficient errors.
- A new movement type needs: migration changing the check constraint and function, TypeScript `MovementType`, reconcile/view update, a ledger test, a report update.

## Review checklist

- Does any new SQL write the ledger or balances directly? Reject.
- Is the movement inside the request's tenant transaction (`route()`), so a later failure rolls it back?
- Are quantities strings or numerics end to end (no JS floating point on sums)?
- Does the UI confirm before posting, and does the audit entry land in the same transaction?
