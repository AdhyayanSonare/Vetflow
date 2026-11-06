# ADR 0001: PostgreSQL, SQL-first migrations

Status: accepted.

The repo used MySQL through Drizzle. The brief needs row-level security, `pg_trgm` fuzzy matching and `pg-boss` jobs, which are PostgreSQL features, so the data layer moves to PostgreSQL 16 or later (tests run 18).

- **Migrations** are plain SQL files in `db/migrations/`, applied by `server/db/migrate.ts`. Each applied file is stored with a SHA-256 checksum, and the runner refuses to continue if an applied file changes.
- **Queries** use `pg` directly. The stock write path is a PL/pgSQL function, which Drizzle would not help with. Drizzle is no longer used for new tables.
- **Tenancy**: every tenant table has `tenant_id` and a forced RLS policy keyed on `app.tenant_id`, set per transaction by `withTenant`. The app connects as `vetflow_app` (no superuser, no BYPASSRLS, not an owner).
- **Hosting**: the code needs only `DATABASE_URL`. Tests use an embedded real PostgreSQL. The anywhere-accessible demo can use Supabase (plain Postgres, no Supabase SDK). Production uses the Compose `postgres` service.
- On Supabase, run migrations as the `postgres` role and give `vetflow_app` the password from `APP_DB_PASSWORD`.
