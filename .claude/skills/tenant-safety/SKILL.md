---
name: tenant-safety
description: Multi-tenant isolation rules for Vetflow (PostgreSQL row-level security, the app role, SECURITY DEFINER lookups, ensureOwned). Use when adding or changing tables, migrations, API routes, queries, background jobs or anything that reads data across clinics.
---

# Tenant safety

Many clinics share one database. A leak between clinics is the worst failure this product can have, so isolation is enforced in the database and then checked again in code.

## How it works

- Every tenant table has `tenant_id uuid not null` and **FORCE ROW LEVEL SECURITY** with the policy `tenant_isolation` using `current_setting('app.tenant_id')`.
- The API connects as `vetflow_app`: not a superuser, no BYPASSRLS, cannot UPDATE/DELETE the ledger or audit log, cannot write `stock_balances`.
- `route(pool, "<permission>", handler)` (server/http/route.ts) opens a transaction, sets `app.tenant_id` from the session with `set_config(..., true)`, runs the handler, commits or rolls back. Do not use `pool.query` for tenant data outside it. Jobs use `withTenant(tenantId, fn, pool)`.
- Pre-login lookups that must cross tenants are narrow SECURITY DEFINER functions: `auth_lookup`, `session_lookup`, `reset_lookup`, `list_tenants`. Add another only if unavoidable, return the minimum columns, and test it.

## The trap: foreign keys ignore RLS

A foreign key check reads the parent row without RLS. A user could send another clinic's `itemId` in a body and the insert would succeed. So **every id taken from a request** that points at a tenant table goes through `ensureOwned(c, "items", [ids])` (it queries under RLS) before use. Ids you read from your own query results are already safe.

## Adding a table

In a new numbered migration (never edit an applied one):

1. `tenant_id uuid not null references tenants(id)` and an index starting with it.
2. `alter table x enable row level security; alter table x force row level security;`
3. `create policy tenant_isolation on x using (tenant_id = current_setting('app.tenant_id')::uuid) with check (same);`
4. `grant select, insert, update, delete on x to vetflow_app;` (omit update/delete for append-only tables).
5. Unique constraints include `tenant_id`.
6. Add the table to the RLS test in `tests/db/rls.test.ts` so the suite proves tenant B cannot read or write tenant A's rows.
7. Run `pnpm db:check` against any hosted database: auto-RLS tools can skip policies or grants (migration 0011 exists for that reason).

## Adding a route

- Permission string from `shared/permissions.ts`, enforced server-side in `route()`.
- Zod-validate the body; `ensureOwned` every foreign id; return 404 (not 403) for ids that are not yours, so existence is not revealed.
- Write an audit row with `auditTx` in the same transaction for any change that matters.
- Test: a second tenant's user gets 404/empty for the first tenant's ids, on read and on write.

## Secrets and data

- Config only through `server/config/env.ts`. Hosted databases are reached with TLS and certificate verification always on; there is no switch to turn it off, and none may be added.
- No passwords, tokens or personal data in logs (pino redaction is configured), URLs or error messages.
- Never fetch a URL a user supplied (SSRF).

## Review checklist

- Any `pool.query` on a tenant table outside `route()`/`withTenant`? Reject.
- Any raw `tenant_id` taken from the request body or query? It must come from the session only.
- Any SECURITY DEFINER function that does more than a lookup? Reject or justify.
