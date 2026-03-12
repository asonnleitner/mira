ARG BUN_VERSION=1

FROM oven/bun:${BUN_VERSION}


RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    curl tini \
    && curl -fsSL https://claude.ai/install.sh | bash

WORKDIR /app

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

COPY . .

# Create non-root user — Claude CLI refuses to run as root (UID 0)
RUN groupadd -r botuser && useradd -r -g botuser -d /app botuser \
    && chown -R botuser:botuser /app

USER botuser

CMD ["bun", "run", "src/index.ts"]
