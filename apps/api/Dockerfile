FROM oven/bun:1 AS base
WORKDIR /app

# Copy workspace root config
COPY package.json bun.lock ./

# Copy shared package
COPY packages/shared/package.json packages/shared/
COPY packages/shared/src packages/shared/src/

# Copy API package
COPY apps/api/package.json apps/api/

# Copy web package.json (needed for workspace-aware lockfile resolution)
COPY apps/web/package.json apps/web/

# Install dependencies (workspace-aware)
RUN bun install --frozen-lockfile --production

# Copy API source + data
COPY apps/api/src apps/api/src/
COPY apps/api/data apps/api/data/

# Run as non-root user (least-privilege principle)
USER bun

EXPOSE ${PORT:-4000}
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=5 \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.PORT || '4000') + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
WORKDIR /app/apps/api
CMD ["bun", "run", "src/bootstrap.ts"]
