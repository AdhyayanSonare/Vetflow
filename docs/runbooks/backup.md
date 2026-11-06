# Backup runbook

## What is backed up

Everything lives in one PostgreSQL database: clinical records, the stock ledger, users, the audit log and invoice attachments (stored in the database). A nightly job streams `pg_dump` (custom format) into **restic**, which encrypts on the server, deduplicates, and uploads to storage that is **not** on the same machine.

Audio recordings are not stored by default, so there is nothing else to protect. Configuration is `.env`; keep a copy in a password manager.

## Setup

In `.env`:

```
RESTIC_REPOSITORY=s3:s3.amazonaws.com/your-bucket/vetflow   # or any restic backend
RESTIC_PASSWORD=<long random value, also stored off the server>
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
BACKUP_KEEP_DAYS=30
ALERT_WEBHOOK_URL=<a URL that receives a POST when a backup fails>
```

Then `docker compose up -d backup`. The container waits for 02:30 India time each night, runs `deploy/backup/backup.sh`, keeps 30 daily snapshots, and calls `ALERT_WEBHOOK_URL` if anything fails. With no repository configured it says so in its log and idles, so a missing setup is visible rather than silent.

**Run one now** to prove the setup works:

```bash
docker compose exec backup /opt/backup/backup.sh
docker compose exec backup restic snapshots
```

## Monitoring the backup

- A failed run calls the webhook. Point it at Uptime Kuma (push monitor) or a chat webhook.
- Look at the log weekly: `docker compose logs --tail 20 backup` should end with `backup complete: <time>`.
- Once a quarter, do the restore drill.

## What the app does on its own

The nightly worker also reconciles every item's balance against the ledger and records any difference as an alert. That is a data-integrity check, not a backup.

## Losing the key

If `RESTIC_PASSWORD` is lost, existing backups cannot be opened. There is no recovery. Store it in two places.
