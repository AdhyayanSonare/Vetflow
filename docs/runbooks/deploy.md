# Deploy runbook

One Linux VM running Docker. About 20 minutes the first time.

**Status:** the Compose file, Dockerfile and backup image are written but have not been run end to end on a server yet (the machine used to build this had no Docker daemon). The application bundle that the image runs *is* tested: `tests/unit/bundle.test.ts` builds it into the image's folder layout and runs migrate, create-clinic, start and sign-in. Treat the first deploy as a rehearsal and keep this page open.

## What you need

- A VM with 2 CPUs and 4 GB of memory (more if you also run the local speech service), 20 GB of disk, Docker Engine 24 or later with the Compose plugin.
- A domain name pointing at the VM, and ports 80 and 443 open. A domain gives automatic HTTPS.
- An off-machine place for backups: an S3-compatible bucket (or any restic target).
- Optional: a Groq API key for hosted speech to text and note drafting.

## 1. Get the code and configure

```bash
git clone https://github.com/AdhyayanSonare/Vetflow.git && cd Vetflow
cp .env.production.example .env
```

Edit `.env`:

| Setting | What to put |
|---|---|
| `SITE_ADDRESS` | Your domain, for example `vetflow.example.com`. `:80` serves plain HTTP for a trial. |
| `POSTGRES_PASSWORD`, `APP_DB_PASSWORD` | Two different long random values, letters and numbers only (they go into connection URLs). |
| `COOKIE_SECURE` | Leave as `true` when you have HTTPS. Set `false` only for a plain-HTTP trial. |
| `GROQ_API_KEY` | Optional. Blank means voice recording is off and typed dictation still works. |
| `SITE_PASSWORD` | Optional shared password in front of everything, useful for a public demo. |
| `RESTIC_REPOSITORY`, `RESTIC_PASSWORD`, `AWS_*` | Backups. See [backup.md](backup.md). Keep `RESTIC_PASSWORD` somewhere safe that is not this server: without it a backup cannot be opened. |

`.env` is ignored by git. Never commit it.

## 2. Start

```bash
docker compose up -d --build
docker compose ps
```

Order is enforced: `postgres` becomes healthy, `migrate` runs once and exits, then `api` and `worker` start, then `proxy`. When `docker compose ps` shows `api` healthy:

```bash
curl https://vetflow.example.com/api/health
```

## 3. Create the first clinic and admin

```bash
docker compose run --rm migrate node dist/tenant-create.js \
  --clinic "Greenfield Veterinary Group" \
  --admin-email owner@greenfield.example \
  --admin-name "Asha Rao"
```

It prints a one-time password. Sign in, open **Settings, Users**, and set your own password. Then add branches, staff and the catalogue (or use **Inventory, Import** for an Excel list).

Never run `pnpm db:seed` or `pnpm demo` against a real database: they load invented demo data with a public password.

## 4. Check it

1. Sign in over HTTPS and open **Today**.
2. **Settings, Features**: voice on or off as you intend.
3. `docker compose logs --tail 50 api worker` shows no errors.
4. Run the first backup by hand and the restore drill ([restore.md](restore.md)). Do not skip this.

## Updating

```bash
git pull
docker compose up -d --build     # migrations run automatically before the new api starts
```

Applied migrations are immutable and checksummed: a changed old migration stops the deploy with a clear message instead of changing your data. Roll back by checking out the previous commit and rebuilding; migrations are forward-only, so for a bad migration restore the backup taken before the update (take one first: `docker compose exec backup /opt/backup/backup.sh`).

## Optional services

- Local speech service: `docker compose --profile asr up -d`, then set `ASR_URL=http://asr:8000` in `.env` and `docker compose up -d api`.
- Uptime monitoring: `docker compose --profile monitoring up -d`, then open `http://127.0.0.1:3001` through an SSH tunnel and add a check for `/api/health` with email alerts.

## Hosted PostgreSQL instead of the bundled one

Skip the `postgres` and `migrate` containers by setting `ADMIN_DATABASE_URL` (owner connection) and `APP_DB_PASSWORD` for your provider and running `pnpm db:migrate` from a trusted machine. The connection always verifies the server certificate; pass the provider's CA file in `DATABASE_CA_CERT`. Supabase's root certificate is included in `certs/`. The owner role must be a superuser or have BYPASSRLS.
