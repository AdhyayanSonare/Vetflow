# Architecture (as found, Step 0 recon)

Recorded before any production work. Describes the repository as it is today.

## Stack
- Language: TypeScript (ESM), Node 22 in Docker (Node 24 locally).
- Frontend: React 19, Vite 7, Tailwind 4, shadcn/ui (Radix), wouter 3 (patched), TanStack Query, tRPC client.
- Backend: Express 4 with tRPC 11 (`server/_core/index.ts`), superjson. Routes under `/api/`.
- Build: `vite build` for the client to `dist/public`; esbuild bundles the server to `dist/index.js`.
- Tests: Vitest (server tests, `client/src/lib/voice.test.ts`). No Playwright, no lint step, no CI config.

## Routing and state
- `App.tsx` mounts `Home` for every path. `Home.tsx` (538 lines) holds all modules (dashboard, patients, consultations, prescriptions, appointments, inventory placeholder, reports, settings). The active view comes from the URL path via `viewFromPath`.
- State is React `useState` in `Home.tsx`, serialised to `localStorage` key `vetflow-demo-state`.

## Data storage
- All clinical data (patients, consultations, prescriptions, appointments) lives only in browser `localStorage`, seeded with demo records.
- Drizzle is configured for **MySQL** (`drizzle-orm/mysql-core`, `mysql2`). The schema has one table, `users`. `server/routers.ts` exposes only `system` and `auth`. No feature router exists.

## Auth
- Manus platform OAuth (`server/_core/oauth.ts`, `sdk.ts`), JWT session cookie via `jose`. The UI has no login flow. Roles are `user` / `admin` only. Not suitable for individual hospital accounts, branch scoping or Argon2id passwords.

## Voice today
- Browser `MediaRecorder` (`useAudioRecorder.ts`) posts raw audio to `POST /api/voice/transcribe` (`server/voiceUpload.ts`), which calls Groq Whisper (`whisper-large-v3`) over the internet. Needs `GROQ_API_KEY`. No auth on the endpoint. No structuring step; notes are typed by the vet.

## Deployment
- `Dockerfile` (single Node image). Platform-managed Manus config (`_core/`, `.manus-starter-init.json`, `manus-routes.json`, debug collector in `vite.config.ts`). No compose file, proxy, backups, CI or monitoring.

## Gaps against the brief
1. Database is MySQL; the brief needs PostgreSQL (row-level security, pg_trgm, pg-boss). **This blocks the requirements**, so the data layer moves to PostgreSQL. Drizzle stays (it supports Postgres); the `users` table is the only data to migrate, and it is replaced by the new accounts model.
2. Auth must be replaced (individual accounts, Argon2id, CSRF, branch scope).
3. `Home.tsx` needs splitting into routed modules before the inventory work.
4. Voice must move from Groq (cloud) to a local `asr` service.
5. Manus-specific scaffolding (`_core` OAuth, storage proxy, debug collector) is not needed on a self-hosted VM.
6. `docs/inputs/` does not exist, so the Astraon Inventory PRD and Vetflow plan are not in the repo.
