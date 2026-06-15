FROM oven/bun:1-alpine AS deps

WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    DATA_DIR=/app/data

COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock bunfig.toml ./
COPY src ./src
COPY scripts ./scripts

RUN mkdir -p /app/data && chown -R bun:bun /app/data

USER bun

VOLUME ["/app/data"]

CMD ["bun", "run", "start"]
