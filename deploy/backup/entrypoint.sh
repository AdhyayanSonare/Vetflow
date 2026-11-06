#!/bin/sh
# Runs a backup every night at 02:30 India time (21:00 UTC) and tells ALERT_WEBHOOK_URL if one fails.
set -u

notify() {
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl -fsS -X POST -d "Vetflow backup problem on $(hostname) at $(date -u +%FT%TZ)" "$ALERT_WEBHOOK_URL" >/dev/null 2>&1
  fi
}

if [ -z "${RESTIC_REPOSITORY:-}" ] || [ -z "${RESTIC_PASSWORD:-}" ]; then
  echo "Backups are not configured: set RESTIC_REPOSITORY and RESTIC_PASSWORD in .env. Idling." >&2
  notify
  exec sleep infinity
fi

while true; do
  now=$(date -u +%s)
  midnight=$((now - now % 86400))
  target=$((midnight + 75600))
  if [ "$target" -le "$now" ]; then target=$((target + 86400)); fi
  echo "next backup in $((target - now)) seconds"
  sleep $((target - now))
  /opt/backup/backup.sh || notify
done
