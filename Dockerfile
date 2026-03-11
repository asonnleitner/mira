FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .

# Create non-root user — Claude CLI refuses to run as root (UID 0)
RUN groupadd -r botuser && useradd -r -g botuser -d /app botuser \
    && chown -R botuser:botuser /app

USER botuser

CMD ["bun", "run", "src/index.ts"]
