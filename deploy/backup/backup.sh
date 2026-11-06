#!/bin/sh
# One encrypted backup: pg_dump streamed into restic (client-side encryption, deduplicated, kept off this machine).
set -eu
: "${PGURL:?PGURL is not set}"
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is not set}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD is not set}"

restic snapshots >/dev/null 2>&1 || restic init
pg_dump --format=custom --no-owner "$PGURL" | restic backup --stdin --stdin-filename vetflow.dump --tag vetflow --tag nightly
restic forget --tag nightly --keep-daily "${BACKUP_KEEP_DAYS:-30}" --prune
echo "backup complete: $(date -u +%FT%TZ)"
