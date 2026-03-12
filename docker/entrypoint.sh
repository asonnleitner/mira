#!/bin/sh
set -e

echo "Running database migrations..."
bun run src/migrate.ts

echo "Migrations complete. Starting app..."
exec "$@"