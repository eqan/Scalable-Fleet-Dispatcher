# Base image is parameterized via ARG with a pinned default tag.
ARG BUN_IMAGE=oven/bun:1
# hadolint ignore=DL3006
FROM ${BUN_IMAGE} AS build
WORKDIR /app

# Copy workspace root config
COPY package.json bun.lock ./

# Copy shared package
COPY packages/shared/package.json packages/shared/
COPY packages/shared/src packages/shared/src/

# Copy web package
COPY apps/web/package.json apps/web/

# Copy api package.json (needed for workspace-aware lockfile resolution)
COPY apps/api/package.json apps/api/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy web source
COPY apps/web/ apps/web/

# Build the frontend
WORKDIR /app/apps/web
RUN bun run build

# Serve with nginx
# Serving image is parameterized via ARG with a pinned default tag.
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.27-alpine
# hadolint ignore=DL3006
FROM ${NGINX_IMAGE}
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx/default.conf.template /etc/nginx/templates/default.conf.template

ENV API_HOST=api
ENV API_PORT=4000

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
