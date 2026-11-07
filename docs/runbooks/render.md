# Live demo on Render (vetflow.astraonlabs.com)

One Render web service (**free plan**) built from this repository's `Dockerfile`, talking to a hosted PostgreSQL (the Supabase project, also free). Render provides HTTPS. About 20 minutes.

**Why Supabase and not Render's own database:** Vetflow's security needs a database owner that can bypass row-level security to run migrations, and a separate restricted role for the app. The Supabase `postgres` role provides that and the schema is already verified there (`pnpm db:check`). Render's managed Postgres is not verified for this.

## 1. Render service (you, once)

1. Render dashboard > **New > Blueprint** > connect the GitHub repository `AdhyayanSonare/Vetflow`, branch `main`. Render reads `render.yaml`.
2. It asks for four values (secrets, entered only in Render):
   - `ADMIN_DATABASE_URL`: the Supabase owner connection string for the pooler on port 5432 (the same value as in your local `.env`).
   - `APP_DB_PASSWORD`: the password of the `vetflow_app` database role (the same as local).
   - `SITE_PASSWORD`: a password you choose. **Required for a public demo.** The demo accounts have a public password; this keeps strangers out. Give it to the client with the link.
   - `GROQ_API_KEY`: optional, for voice. Leave empty to demo with typed dictation.
3. Create. The first deploy builds the image (about 5 minutes), applies pending migrations (`node dist/db-migrate.js`, repeatable), and starts the app. Wait for the health check (`/api/health`) to go green.
4. Open the `onrender.com` address Render shows. A browser prompts for the site password, then the Vetflow sign-in appears.

## 2. Your domain (you, once)

In Render: the service > **Settings > Custom Domains** shows `vetflow.astraonlabs.com`. At your DNS provider for `astraonlabs.com`, add:

| Type | Name | Value |
|---|---|---|
| CNAME | `vetflow` | the `<service>.onrender.com` address Render shows |

Render verifies it and issues the HTTPS certificate automatically (a few minutes after DNS updates). Do not put it behind another proxy that terminates TLS differently unless you set the client IP header correctly.

## 3. Demo data (once, from a machine with the repository and `.env`)

```bash
pnpm db:seed --allow-remote
```

The seed refuses to run if any clinic already exists, so it cannot overwrite real data. It creates the invented "Greenfield Veterinary Group" with six accounts; the shared password is printed and listed in `docs/demo.md`. For a real client, create their clinic instead with `pnpm tenant:create` and do not seed.

## 4. Before the client call

1. Open `https://vetflow.astraonlabs.com` in a private window. Enter the site password. Sign in as `dr.sharma@greenfield.demo`.
2. Walk the ten-minute script in `docs/demo.md` once, on a phone and on a laptop.
3. Check the pinger is green and the health check is green.
4. Afterwards, rotate `SITE_PASSWORD` in Render, or suspend the service, so the demo is not left open.

## Keeping the free instance awake

A free Render service sleeps after 15 minutes with no traffic, and the first request afterwards takes about a minute. For a client call, avoid that:

1. Create a free account at UptimeRobot (or cron-job.org) and add an HTTPS monitor on `https://vetflow.astraonlabs.com/api/health` every 5 minutes. That address is exempt from the site password, so the pinger needs no credentials.
2. Free services get 750 instance hours a month, enough for one service running all month.
3. Before a call, open the site five minutes early anyway. If it ever shows a loading page, wait a minute and refresh: it is waking up.
4. A free instance has 512 MB of memory. This is enough for a demo with a few users.

## Notes and limits

- The demo data is invented; never put real patient or client data into a database that holds the public demo accounts.
- `COOKIE_SECURE` is on, which is right behind Render's HTTPS.
- Logs: Render dashboard > Logs. Updates deploy automatically when `main` changes; migrations run before the new version starts.
- Not tested on Render itself yet. The same image was run with Docker Compose and in CI.
