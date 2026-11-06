# Plan and checklist

The single source of truth for what is done and what is left. Updated at every step. Status: `[x]` done and tested, `[~]` partly done, `[ ]` not started.

## Decisions taken on the user's behalf
- PostgreSQL replaces MySQL. Manus OAuth and the unauthenticated Groq route are removed.
- Hosted APIs are allowed for now: Groq Whisper for transcription and Groq chat for note extraction (from the collaborator's branches). The local `asr` service (Canary, faster-whisper) is built and selectable, but its accuracy on real clinic audio is unmeasured.
- The deployed demo database is the Supabase project in `.env` (Sydney, ref `oxeuunpcdtstanrxniwa`). The project in the first dashboard link (Tokyo) is not used.
- Brand: Astraon tokens from the brief, applied to the collaborator's mobile-first UX (bottom tab bar, centre Record button, 44 px targets, 16 px inputs).
- Controlled medicines: item flag, reason and second-user password confirmation. No legal claims in the UI.
- Valuation: actual cost per batch. Multi-dose vials: tracked, optional per item.

## Backend
- [x] PostgreSQL schema, forced RLS, append-only ledger and audit log (migrations 0001-0011)
- [x] Stock ledger: one SQL function, FEFO, idempotency, negative-stock override with audit, reconciliation
- [x] Accounts: Argon2id, sessions, CSRF, lockout, rate limit, password reset, five roles, branch scoping
- [x] Catalogue with pg_trgm similar-name warnings, suppliers, categories
- [x] Purchasing: draft and confirmed receipts, purchase orders with partial receipts, low-stock orders, invoice attachments
- [x] Stock operations: adjustments, issue to department, return, transfers via in-transit store, counts, multi-dose vials
- [x] Clinical: animals, consultations, transcripts, prescriptions with hard doctor approval, dispensing linked to prescriptions, controlled-item witness
- [x] Dashboard, nine reports, CSV and Excel export, alerts, nightly checks, transcript retention, pg-boss worker
- [x] Excel import with validation preview (opening stock as a draft receipt)
- [x] Voice: transcription route (Groq or local), LLM extraction with grounding, catalogue matching, split-word matching
- [x] Config module, strict TLS, pino logging, domain-module structure
- [x] Seed (synthetic, labelled), `pnpm demo` launcher, schema signature and baseline tools
- [x] Supabase database verified: 11 migrations recorded, 0 schema mismatches, app-role security checks pass
- [ ] Legacy importer for the browser demo data (localStorage)
- [ ] Tests: 143 passing. To add: legacy import, subscription invoices

## Frontend (rebuild, API-backed)
- [x] Structure: `client/src/{app,api,features,components,hooks,lib,styles}`, TanStack Query, business logic in hooks and pure modules
- [x] Astraon tokens (CSS variables + Tailwind theme), self-hosted Source Serif 4, IBM Plex Sans and Mono, dark theme
- [x] Shell: sidebar (desktop), icon rail (tablet), bottom tab bar with Record (phone)
- [x] Sign-in, password reset
- [~] Today (dashboard) done; alerts page with inventory
- [x] Patients: list, register, profile
- [x] Consultation flow: record or upload or type, transcribe, extract, review notes, prescription, approve, done (e2e at 3 sizes)
- [ ] Prescriptions list and print view
- [ ] Dispensing queue and counter sale (controlled-item witness)
- [ ] Inventory: items, item detail with batches and ledger, receipts, orders, suppliers, transfers, counts, vials, adjustments, import
- [ ] Reports (filters, CSV, Excel, print)
- [ ] Settings: users, branches, feature flags, subscription, licences, audit
- [ ] Barcode input (keyboard scanners always; camera scanner behind the flag)
- [ ] Responsive at 375, 768 and 1280 px, 44 px targets, no horizontal scroll
- [~] Playwright tests at three sizes, screenshots in `docs/qa/` (smoke + consultation done; more specs per feature)

## Operations and quality
- [ ] ESLint, licence allow-list check, secret scan, `pnpm audit` in `pnpm check`
- [ ] Docker Compose (proxy, api, worker, asr, postgres, backup), Caddy TLS, health checks
- [ ] Encrypted backup, restore script and a timed restore drill
- [ ] GitHub Actions on Linux, macOS and Windows
- [ ] Performance gates: item search p95 under 300 ms at 10,000 items, dashboard under 2 s at 500,000 ledger rows
- [ ] ASR eval harness (`eval/asr`) and ADR for the model choice (numbers only from real clips)
- [ ] CLAUDE.md under 150 lines, project skills, hooks
- [ ] Docs: ARCHITECTURE, runbooks (deploy, backup, restore, incident), admin and user guide, demo guide, TEST-MAP
- [ ] Security review by the read-only subagent; fresh-clone verification
- [ ] Merge into `main`; push only after everything above passes

## Needs the user
- Real consultation recordings with reference text (50 or more) to measure ASR accuracy.
- Client item list and opening stock.
- A `GROQ_API_KEY` in `.env` to enable hosted transcription and extraction in the demo.
- Whether controlled medicines carry any legal register requirement in the client's jurisdiction.
