#!/bin/sh
set -e

# Fix ownership of mounted volumes
chown -R bun:bun /app/data /app/db /home/bun/.claude 2>/dev/null || true

echo "Running database migrations..."
setpriv --reuid=bun --regid=bun --init-groups bun run src/migrate.ts

echo "Migrations complete. Starting app..."
exec setpriv --reuid=bun --regid=bun --init-groups "$@"