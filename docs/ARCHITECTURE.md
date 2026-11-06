# Architecture

Vetflow is one Node web app (Express API plus a React single-page client) on PostgreSQL, with a nightly worker and an optional speech service. This document describes the system as it is built. The recon of the original demo is kept at the end.

## The big picture

```
Browser (React, TanStack Query)  --HTTPS-->  proxy (Caddy)  -->  api (Express)  -->  PostgreSQL
                                                                      |                 ^
                                              worker (pg-boss) -------+-----------------+
                                              asr (optional)  <-------+   Groq (optional, hosted)
```

| Part | Where | Notes |
|---|---|---|
| Client | `client/src` | React 19, Vite, Tailwind 4, wouter. Server state in TanStack Query. |
| API | `server/` | Express. One folder per domain in `server/modules/`. |
| Database | `db/migrations` | PostgreSQL 16 or later. SQL migrations, checksummed. |
| Worker | `server/jobs` | pg-boss. Nightly reconciliation, alerts, transcript retention. |
| Speech | `asr/` | Python service. Canary-180M-Flash, faster-whisper for Hindi. Optional. |
| Shared | `shared/` | Permission map and request types used by both sides. |

## Server structure

```
server/
  app.ts            builds the Express app from a pool and providers. No global state.
  index.ts start.ts entry point and the start/stop function the demo reuses
  config/           env.ts (every environment variable, validated once), database.ts (strict TLS)
  http/             errors, route() wrapper, middleware (headers, session, CSRF, logging), rate limit, schemas
  db/               pool (withTenant), migrate, signature (schema comparison), seed
  logging/          pino with redaction
  jobs/             nightly checks and the pg-boss worker
  modules/
    auth/           sessions, Argon2id, lockout, reset, permission checks
    catalogue/      categories, items (similar-name warning), suppliers
    purchasing/     receipts, purchase orders with partial receiving
    stock/          the ledger service, adjustments, issue, return, transfers, counts, vials
    clinical/       animals, owners, consultations, prescriptions
    dispensing/     dispenses, controlled-item witness
    reports/        nine reports, dashboard, alerts, CSV and Excel export
    importer/       Excel import with validation preview
    attachments/    invoice scans (type checked by content)
    admin/          users, settings, feature flags, subscription, licences
    voice/          transcription clients, extraction, catalogue matching
```

Each module owns its SQL, validation and permission checks. Modules share only `http/` and the stock ledger. To add one: create `modules/<name>/routes.ts` exporting `registerXRoutes(app, pool)` and add a line to `modules/index.ts`.

## Rules the code enforces

1. **Tenancy.** Every tenant table has `tenant_id` and a forced row-level-security policy keyed on `app.tenant_id`, set per transaction by `withTenant`. The app connects as `vetflow_app`, which is not a superuser, cannot bypass RLS, and cannot update or delete ledger or audit rows. Foreign keys are checked without RLS, so routes call `ensureOwned` on every id taken from a request body.
2. **One stock writer.** All stock changes go through the SQL function `apply_stock_movement`: one ledger row and the balance change in one transaction, with a row lock, an idempotency key, the expiry rule and the negative-stock rule. Application code cannot write balances.
3. **Draft, then human.** Voice output and imports only create drafts. A vet approves a prescription. A confirmed dispense takes stock out. A receipt adds stock only when confirmed.
4. **Approved means frozen.** Triggers in the database stop edits to an approved prescription, even from SQL.
5. **Dates and money.** UTC in the database, Asia/Kolkata on screen (`today_ist()` for expiry checks). Money is integer paise.
6. **Every high-impact action asks and is audited.** The client uses one `useConfirm()` hook. The server writes an audit row in the same transaction as the change.

## Client structure

```
client/src/
  app/         App, Providers, Router (lazy pages, permission guards), nav.ts, layout/ (sidebar, tab bar, top bar)
  api/         client.ts: the only place that calls fetch (CSRF, typed errors, 401 handling)
  features/    one folder per area: api.ts (types and query hooks), pages, dialogs, pure logic
  components/  ui/ (shadcn primitives), common/ (page, table, dialogs, fields, states)
  hooks/ lib/  recorder, media queries, formatting, money, voice helpers
  styles/      Astraon tokens as CSS variables, mapped into Tailwind
```

- **State.** Server data lives in TanStack Query, with one `useInvalidateStock` that refreshes everything a stock change touches. Sign-in state is a context. Nothing important is kept only in the browser.
- **Logic out of components.** The consultation is a hook (`useConsultationFlow`) plus pure functions (`logic.ts`, unit tested). Screens read the hook and render.
- **Responsive.** Sidebar from 1024 px, icon rail from 768 px, bottom tab bar with a Record button below that. Tables become cards on phones. Controls are at least 44 px. Pages never scroll sideways. End-to-end tests check all of this at 375, 768 and 1280 px.

## Voice

1. The browser records with MediaRecorder, or the user uploads a file, or types text.
2. `POST /api/voice/transcribe` checks sign-in, role, the tenant's voice switch, the file type by its bytes, and the size, then calls the configured provider (Groq Whisper, or the local `asr` service). Audio is never stored.
3. The transcript is saved, then `POST /api/consultation/extract` (Groq chat, with every medicine checked against the transcript) or `POST /api/voice/structure` (rules only) drafts notes and prescription lines.
4. Lines are matched to the tenant's catalogue by trigram similarity, including drug names the recogniser split ("Car Pro FN" finds Carprofen). An ambiguous or missing match is shown for a person to resolve.
5. The vet reviews, and approval is a separate server-side step.

## Deployment

`docker-compose.yml`: `postgres`, `migrate` (one shot), `api`, `worker`, `proxy` (Caddy with automatic TLS), `backup` (nightly restic), and optional `asr` and `uptime`. Everything is configured by environment variables. See the runbooks.

## Decisions

See `docs/adr/`. Short version: PostgreSQL with SQL-first migrations and RLS; individual accounts with Argon2id and database-backed sessions; the speech provider is a function behind an interface; hosted APIs are allowed for now and local models stay selectable.

## Original recon (before the rebuild)

The repository started as a React and Express demo from a Manus template: MySQL through Drizzle with one `users` table, Manus OAuth with no login screen, all clinical data in browser `localStorage`, a single 538-line `Home.tsx`, and an unauthenticated Groq transcription route. The collaborator branches added a design spec, a redesigned mobile UI, and Groq note extraction. All of that was merged and then rebuilt on the structure above.
