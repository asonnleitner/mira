ARG BUN_VERSION=1

FROM oven/bun:${BUN_VERSION} AS base

WORKDIR /app

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    curl tini \
    && curl -fsSL https://claude.ai/install.sh | bash

FROM base AS deps

COPY package.json bun.lock ./

RUN bun install

FROM base AS final

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json drizzle.config.ts ./
COPY src ./src

RUN mkdir -p /app/data /app/db /home/bun/.claude \
     && chown -R 1000:1000 /app

RUN bun install --frozen-lockfile

USER bun

ENTRYPOINT ["tini", "--"]
CMD ["bun", "run", "src/index.ts"]
