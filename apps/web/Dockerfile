# FROM-scoped ARGs must be declared before the first FROM. An ARG placed
# after a stage's FROM belongs to that stage and is invisible to the next
# FROM — BuildKit then resolves ${NGINX_IMAGE} to blank and fails the build.
ARG BUN_IMAGE=oven/bun:1
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.27-alpine

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

# hadolint ignore=DL3006
FROM ${NGINX_IMAGE}
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx/default.conf.template /etc/nginx/templates/default.conf.template

ENV API_HOST=api
ENV API_PORT=4000

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
