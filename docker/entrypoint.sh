#!/bin/sh
set -e

bun run src/migrate.ts
exec "$@"
