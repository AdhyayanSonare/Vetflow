# Test map

What is proved, and by which test. Names are the titles in the test files, so a failing line points straight to the code. Run everything with `pnpm check` (types, lint, 200+ tests against a real PostgreSQL) and `pnpm e2e` (browser, three screen sizes).

## Rules the product must keep

| Rule | Proved by |
|---|---|
| **Stock is an append-only ledger and the balance always equals it** | `tests/db/ledger.test.ts`: "random operation sequences keep balances equal to the ledger and never negative" (fast-check); "reconciliation reports a deliberately corrupted balance". `tests/db/rls.test.ts`: "blocks update and delete on the audit log". |
| **Only the stock function writes balances** | `tests/db/ledger.test.ts`: "the app role cannot write balances directly". |
| **No negative stock, except an audited, authorised override** | "blocks negative stock"; "override needs tenant setting, an allowed role and a reason, and writes an audit row". |
| **Retries and races are safe** | "replaying an idempotency key changes nothing"; "simultaneous issues of the last unit: exactly one succeeds"; "the same key sent concurrently is applied once"; "a failed multi-row write leaves no partial rows". |
| **Earliest expiry first; expired stock is never issued** | "batches keep independent quantity and expiry, and FEFO draws the earliest first"; "expired stock cannot be issued or dispensed, but can be written off"; `clinical-dispensing`: "expired stock cannot be dispensed". |
| **A receipt adds stock only when confirmed** | `ledger`: "draft receipt leaves stock unchanged; confirmed receipt adds the received quantity exactly once"; `catalogue-purchasing`: "draft receipt leaves stock unchanged; confirm adds it once; stock, low-stock and expiry views agree"; `import`: "commits items and opening stock as a draft receipt; stock changes only when the receipt is confirmed". |
| **Only a confirmed dispense removes stock** | `clinical-dispensing`: "an approved prescription changes nothing; a confirmed dispense lowers stock and shows on the prescription"; "cannot dispense a draft prescription, an item that is not on it, or more than prescribed"; "a multi-line dispense is all or nothing when one line lacks stock". |
| **Doctor approval is a hard step** | "only a vet or admin can approve; unmatched lines block approval"; "an approved prescription is frozen, in the API and in the database". |
| **Controlled medicines need a witness** | "a controlled medicine needs a different second user with a valid password". |
| **Voice and imports only create drafts** | `clinical-dispensing`: "storing a transcript changes no prescription and no stock"; `voice`: "returns nothing for speech with no drug, and never saves a prescription or moves stock"; "a draft goes through the same approval as a typed prescription". |
| **Every clinic sees only its own data** | `tests/db/rls.test.ts` (10 tests: "a tenant sees only its own rows on every tenant table", "cannot insert a row for another tenant", "does not leak the tenant to the next pooled caller"); and one "another tenant cannot ..." test in every API suite (catalogue, stock operations, clinical, reports, admin, orders, voice, extraction). |
| **Everything works with voice and barcode off** | `admin`: "defaults to voice on and barcode off ..."; "with voice and barcode both off, the stock and clinical workflows still complete". |
| **Migrations never change once applied** | `tests/db/migrations.test.ts`: "refuses to run when an applied migration was edited"; "re-running applies nothing". The `.claude` hook blocks the edit before it is made. |

## Accounts and security

| Area | Tests (`tests/api/auth.test.ts` unless noted) |
|---|---|
| Passwords | "hashes with argon2id and verifies"; "enforces a minimum policy" |
| Sign-in | "signs in, sets an HttpOnly SameSite cookie"; "gives the same answer for a wrong password and an unknown email" |
| Lockout and limits | "locks the account after five failed sign-ins and writes an audit row"; "rate-limits sign-in attempts per address and email" |
| CSRF and sessions | "rejects writes without the CSRF header ..."; "an expired session is refused"; "a deactivated user loses access immediately" |
| Reset | "says so plainly when no mail delivery exists, creates no token ..."; "resets once, ends old sessions, and never reveals whether an email exists" |
| Roles | "role permissions: only the right roles can adjust stock or approve prescriptions"; `admin`: "only admins can manage users, settings and subscription", "the last active admin cannot be demoted or deactivated" |
| Headers | "sets security headers" |
| Server recovery | `tests/db/bootstrap.test.ts` (6): create clinic and first admin, isolation, duplicates and rollback, generated passwords, locked-out admin reset |
| Uploads | `attachments-orders`: "stores a PDF or image, identifies it by content"; "rejects files that are not PDF or images ..." |
| Secrets and licences | `tests/unit/scripts.test.ts` (10): secret scanner, licence allow list (SPDX `OR`/`AND`), long-path advice |

## Inventory workflows

| Workflow | Tests |
|---|---|
| Catalogue | `catalogue-purchasing`: similar-name warning, duplicate barcode, PATCH changes only sent fields, readable validation |
| Purchase orders | `attachments-orders`: "draft, send, receive part, confirm, receive the rest ..."; "builds draft orders from the low-stock list" |
| Transfers | `stock-operations`: "dispatch moves stock into transit, receive moves it to the destination, and nothing is consumed"; "a short receipt needs a reason, leaves the shortfall in transit, and raises an alert" |
| Counts | "a variance needs a reason, then posts an adjustment ..."; "a count higher than the system adds stock" |
| Issue, return, write-off | "issue to a department is consumption with a reason; return to store moves stock back ..."; "an expired batch can be written off ..." |
| Multi-dose vials | "opening takes one sealed vial ..."; "a vial past its beyond-use date cannot be drawn from ..."; "refuses to open a vial for an item that is not multi-dose" |
| Excel import | `import` (7): template, check-only run, one bad row stops the commit, duplicates, bad files, tenant-owned store |

## Reports, dashboard, alerts, jobs

| Area | Tests |
|---|---|
| Nine reports | `reports-alerts`: current stock equals the ledger (and as of a past date), valuation at batch cost, movement/expiry/low-stock/purchase/consumption/wastage/audit |
| Exports | "CSV and Excel exports hold the same rows, in rupees, and neutralise spreadsheet formulas" |
| Branch scoping | "a user assigned to one branch sees only that branch" |
| Dashboard | "shows stock value, expiry bands, low stock, pending purchases, top consumed and recent movements" |
| Alerts | "raises expiry, expired and low-stock alerts once ..."; "a corrupted balance raises one critical alert ..." |
| Nightly job | "the nightly run covers every tenant ..."; `tests/db/worker.test.ts`: transcript retention, scheduling through pg-boss |

## Voice

| Area | Tests |
|---|---|
| Transcription endpoint | `voice` (first 5): role and switch, bytes-not-extension validation, size limit, provider failures, rate limit |
| Catalogue matching | "matches a drug, reads dose, frequency and duration, and works out the quantity"; strength disambiguation; several drugs; mis-hearing; split names ("Car Pro FN") |
| Hosted extraction | `extraction` (9): grounding (drops medicines the transcript never mentions), retryable errors without leaking details, tenant scoping |
| Provider clients | `tests/unit/asr-clients.test.ts` (5); `asr/test_app.py` (7, Python) |

**Not tested, and why:** speech accuracy on real clinic recordings (none available; see `docs/PROGRESS.md`), the Docker stack end to end (no Docker daemon on the build machine), and sending mail (no mail server exists).

## Browser (Playwright, `pnpm e2e`)

`e2e/smoke.spec.ts`: every page loads at phone 375, tablet 768 and desktop 1280 without horizontal scroll, with 44 px touch targets, correct navigation for the size, detail pages open from lists, and a prescription prints cleanly. `e2e/consultation.spec.ts`: a vet records (types) a dictation, reviews the draft, edits notes, approves a prescription; a half-finished consultation reopens. `e2e/auth.setup.ts` signs in each role once. 92 tests in the last full run, all passing. Screenshots are written to `docs/qa/`.

## Performance

`pnpm perf` (`scripts/perf.ts`): item search p95 and dashboard time through the real API at 10,000 items and 500,000 ledger rows. Results are recorded in `docs/PROGRESS.md`.
