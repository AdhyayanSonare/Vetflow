#!/bin/sh
# Render start command: apply any pending database migrations (safe to repeat), then start the app.
set -e
node dist/db-migrate.js
exec node dist/index.js
