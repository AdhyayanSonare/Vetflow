# Vetflow

Clinical records, prescriptions and medicine inventory for veterinary hospital groups, by Astraon Labs.

- **Clinical:** patients and owners, consultations, voice or typed dictation that becomes a draft for the vet to review, prescriptions with a hard doctor-approval step.
- **Inventory:** catalogue, suppliers, purchase orders and receipts, batches and expiry, transfers between branches, stock counts, multi-dose vials, low-stock and expiry alerts, nine reports, Excel import.
- **Dispensing:** only a confirmed dispense takes stock out. An approved prescription alone changes nothing. Controlled medicines need a second person.
- **Safe by design:** every tenant row is protected by PostgreSQL row-level security. The stock ledger is append-only. Every high-impact action asks first and is audited.

## Run it on your laptop in one command

You need **Node 22.12 or newer**. Nothing else: no Docker, no database to install.

```bash
corepack enable          # once, so the right pnpm version is used
pnpm install
pnpm demo
```

`pnpm demo` starts a real PostgreSQL, applies the migrations, loads a synthetic demo clinic, builds the app and serves it at <http://localhost:3000>. Press Ctrl+C to stop. The data stays in `.demo-data/` between runs. `pnpm demo:reset` starts fresh.

Sign-in details for the demo accounts are printed when it starts and listed in [docs/demo.md](docs/demo.md). They are synthetic and public. **Never use them for real data.**

It works on Windows, macOS and Linux, on a phone or tablet browser on the same network (open `http://<your-laptop-ip>:3000`), and at any screen size.

### Voice

Voice transcription and note drafting use a hosted API (Groq) when `GROQ_API_KEY` is in `.env`. Without a key everything else still works, and you can type or paste a dictation to try the draft flow. See [Configuration](#configuration).

## Commands

| Command | What it does |
|---|---|
| `pnpm demo` / `pnpm demo:reset` | The one-command demo (see above). |
| `pnpm dev` | The server with hot reload, against the database in `.env`. |
| `pnpm build` / `pnpm start` | Build the client and server, then run `dist/`. |
| `pnpm check` | Type check, lint, and all unit and integration tests. |
| `pnpm test` | Vitest: unit tests and API tests against a real PostgreSQL started by the tests. |
| `pnpm e2e` | Playwright end-to-end tests at phone, tablet and desktop sizes. |
| `pnpm db:migrate` | Apply pending migrations to the database in `.env`. |
| `pnpm db:seed` | Load the demo clinic into an **empty** database. |
| `pnpm db:check` | Check the database and the app role's security settings. Read only. |
| `pnpm db:baseline` | Verify and record migrations for a database set up by hand. |
| `pnpm worker` | The nightly jobs (reconciliation, alerts, transcript retention). |
| `pnpm licences` / `pnpm secrets` | Licence allow-list and secret scans. |

## Configuration

All settings are environment variables, read in one place (`server/config/env.ts`) and documented in [.env.example](.env.example). Copy it to `.env`.

- **Database:** `DATABASE_URL` for the app role, or `ADMIN_DATABASE_URL` plus `APP_DB_PASSWORD` (the app URL is derived). Hosted databases are reached over TLS with certificate checking always on. A CA file can be given in `DATABASE_CA_CERT`; the Supabase root CA is bundled in `certs/`.
- **Voice:** `GROQ_API_KEY` for hosted speech and note drafting, or `ASR_URL` for the local speech service in `asr/`.
- **Optional:** `SITE_PASSWORD` puts the whole site behind a shared password (handy for a public demo).

## Structure

```
client/src/        React app: app/ (shell, routes), features/ (one folder per area), components/, hooks/, lib/, styles/
server/            Express API: modules/ (one folder per domain), http/ (shared plumbing), config/, db/, jobs/
shared/            Code used by both sides: permissions, request and response types
db/migrations/     SQL migrations. Applied files are immutable.
asr/               Speech service (Python): Canary and faster-whisper behind one interface
tests/ e2e/ eval/  API and database tests, browser tests, speech evaluation
deploy/ docs/      Docker, Caddy, backups; architecture, runbooks and guides
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together.

## Deploying

One Linux VM with Docker: `docker compose up -d` brings up PostgreSQL, the app, the nightly worker, a TLS proxy and encrypted backups. Steps are in [docs/runbooks/deploy.md](docs/runbooks/deploy.md), with [backup](docs/runbooks/backup.md), [restore](docs/runbooks/restore.md) and [incident](docs/runbooks/incident.md) runbooks.

## Documentation

[Architecture](docs/ARCHITECTURE.md) · [Demo guide](docs/demo.md) · [Admin guide](docs/guide/admin.md) · [User guide](docs/guide/users.md) · [Test map](docs/TEST-MAP.md) · [Progress and measured numbers](docs/PROGRESS.md) · [Decisions](docs/adr/)

## Licences

Every dependency is on an allow list (MIT, Apache-2.0, BSD, ISC, PostgreSQL) checked in CI. The three typefaces are SIL Open Font Licence, as the brand requires. The speech model credit (Canary-180M-Flash, NVIDIA, CC-BY-4.0) is shown in the app under Licences.
