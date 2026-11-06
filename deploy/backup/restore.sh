#!/bin/sh
# Restores a backup into the database at PGURL. Usage: restore.sh [snapshot-id|latest]
# Run `docker compose run --rm migrate` first on a fresh server, so the app role and schema exist.
set -eu
: "${PGURL:?PGURL is not set}"
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is not set}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD is not set}"
restic dump "${1:-latest}" vetflow.dump | pg_restore --clean --if-exists --no-owner --dbname "$PGURL"
echo "restore complete: $(date -u +%FT%TZ)"
