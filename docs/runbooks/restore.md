# Restore runbook and drill

The point of a backup is the restore. Practise it before you need it, and write down how long it took.

## Restore drill (do this after the first backup, then every quarter)

Use a scratch machine or the same VM with a different project name, never the live database.

```bash
# 1. A clean stack with its own volumes
COMPOSE_PROJECT_NAME=vetflow-drill docker compose up -d postgres
COMPOSE_PROJECT_NAME=vetflow-drill docker compose run --rm migrate      # creates schema and the app role

# 2. Restore the latest snapshot into it
time COMPOSE_PROJECT_NAME=vetflow-drill docker compose run --rm backup /opt/backup/restore.sh latest

# 3. Compare the restored data with the live database
psql "$LIVE_URL"  -f deploy/backup/checksums.sql > live.txt
psql "$DRILL_URL" -f deploy/backup/checksums.sql > drill.txt
diff live.txt drill.txt && echo "MATCH"
```

`checksums.sql` prints row counts and a hash of the stock ledger, the stock balances, prescriptions, users and the audit log, so a silent partial restore shows up as a difference. (The two will differ only by activity since the snapshot: compare right after a manual backup for an exact match.)

4. Start the whole stack against the drill database, sign in, open an item and a prescription.
5. Tear down: `COMPOSE_PROJECT_NAME=vetflow-drill docker compose down -v`.

**Record the date and the `time` result in `docs/PROGRESS.md`.** The target is under 15 minutes for a clinic-sized database. No drill has been run yet; the first one is part of deployment.

## Restore for real (the live database is damaged or lost)

1. Stop writes: `docker compose stop api worker proxy`.
2. On a new VM, follow [deploy.md](deploy.md) steps 1 and 2 up to `migrate`, but do **not** create a clinic.
3. `docker compose run --rm backup /opt/backup/restore.sh latest` (or a snapshot id from `restic snapshots`, if the latest is the damaged one).
4. `docker compose up -d`. Sign in and check **Inventory, Alerts**: the nightly reconciliation should report no difference.
5. Work done since the snapshot is lost (at most one day). Tell the clinic what time the data goes back to, and ask them to re-enter anything in between from paper.

## Restoring one thing

Individual records are not edited by restoring. Stock errors are corrected with a count adjustment or a reversing movement (the ledger is append-only), and mistaken records are corrected in the app with an audit trail.
