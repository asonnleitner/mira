<p align="center">
  <img src="docs/banner.png" alt="Mira" />
</p>

# Mira

AI-powered therapy bot for Telegram, built on Claude.

Mira provides structured therapeutic conversations through Telegram — supporting individual and couples therapy, clinical intake, automated check-ins, and multilingual support.

## Features

- Individual therapy sessions
- Couples therapy with shared context
- Structured intake onboarding
- Automated check-ins on configurable schedules
- Multilingual support
- Clinical notes and session summaries
- OpenTelemetry observability

## Tech Stack

Bun · TypeScript · grammY · Claude Agent SDK · Drizzle ORM · SQLite · OpenTelemetry

## Getting Started

**Prerequisites:** [Bun](https://bun.sh), a Telegram bot token, an Anthropic API key.

```bash
cp .env.example .env   # fill in your values
bun install
bun run db:push
bun run dev
```

## Docker

```bash
docker compose up -d
```

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `BOT_TOKEN` | Telegram bot token | *required* |
| `ANTHROPIC_API_KEY` | Anthropic API key | *required* |
| `DATABASE_URL` | SQLite database path | `sqlite.db` |
| `DATA_DIR` | Data directory | `./data` |
| `OTEL_SERVICE_NAME` | OTel service name | `mira-bot` |
| `OTEL_SERVICE_VERSION` | OTel service version | `1.0.0` |
| `OTEL_CAPTURE_CONTENT` | Capture message content in traces | `false` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTel exporter endpoint | — |
| `OTEL_EXPORTER_OTLP_HEADERS` | OTel exporter headers | — |
| `ENVIRONMENT` | Runtime environment | `development` |
| `LOG_LEVEL` | Log level | `info` |
| `PORT` | Health check port | `3000` |
| `CHECKIN_INTERVAL_MINUTES` | Check-in scheduler interval | `15` |
| `CHECKIN_DEFAULT_DAYS` | Default days between check-ins | `3` |
| `CHECKIN_WINDOW_START` | Earliest hour for check-ins | `9` |
| `CHECKIN_WINDOW_END` | Latest hour for check-ins | `20` |
| `CHECKIN_TIMEZONE` | Timezone for check-in windows | `Europe/Prague` |

## Scripts

| Command | Description |
|---|---|
| `bun run dev` | Start the bot |
| `bun run check` | Typecheck + lint |
| `bun run typecheck` | TypeScript type checking |
| `bun run lint` | Run ESLint |
| `bun run lint:fix` | Run ESLint with auto-fix |
| `bun run db:generate` | Generate Drizzle migrations |
| `bun run db:migrate` | Run Drizzle migrations |
| `bun run db:push` | Push schema to database |
| `bun run db:studio` | Open Drizzle Studio |

## Project Structure

```
src/
├── agent/       # Claude agent configuration, tools, and hooks
├── bot/         # Telegram bot setup, commands, menus, and middleware
├── db/          # Drizzle ORM schema and database access
├── scheduler/   # Automated check-in scheduling
├── storage/     # File and session storage
└── telemetry/   # OpenTelemetry instrumentation
```
