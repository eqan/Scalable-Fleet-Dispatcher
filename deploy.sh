#!/usr/bin/env bash
# ================================================================
# Production Deployment Script
# Run from the monorepo root on the production server
# ================================================================

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIST="$APP_DIR/apps/web/dist"
NGINX_SERVE_DIR="/var/www/arqhfront/build"

echo "=== ArqhWebApp Production Deploy ==="
echo "Working directory: $APP_DIR"
cd "$APP_DIR"

# ----------------------------------------------------------------
# Step 1: Install dependencies
# ----------------------------------------------------------------
echo ""
echo "[1/6] Installing dependencies..."
bun install --frozen-lockfile

# ----------------------------------------------------------------
# Step 2: Build the frontend
# ----------------------------------------------------------------
echo ""
echo "[2/6] Building frontend (apps/web)..."
cd "$APP_DIR/apps/web"
bun run build
cd "$APP_DIR"

# ----------------------------------------------------------------
# Step 3: Deploy frontend static files to Nginx serve directory
# ----------------------------------------------------------------
echo ""
echo "[3/6] Deploying frontend to $NGINX_SERVE_DIR..."
mkdir -p "$NGINX_SERVE_DIR"
rm -rf "${NGINX_SERVE_DIR:?}"/*
cp -r "$FRONTEND_DIST"/* "$NGINX_SERVE_DIR/"
echo "Frontend deployed: $(du -sh "$NGINX_SERVE_DIR" | cut -f1)"

# ----------------------------------------------------------------
# Step 4: Reload Nginx (picks up any config changes)
# ----------------------------------------------------------------
echo ""
echo "[4/6] Testing and reloading Nginx..."
nginx -t && systemctl reload nginx
echo "Nginx reloaded."

# ----------------------------------------------------------------
# Step 5: Restart API + Worker processes via PM2
# ----------------------------------------------------------------
echo ""
echo "[5/6] Restarting API and Worker..."

# Stop old processes (ignore errors if they don't exist yet)
pm2 delete arqh-api 2>/dev/null || true
pm2 delete arqh-worker 2>/dev/null || true

# Start both processes from ecosystem config
# (ecosystem.config.cjs reads .env and passes vars to both processes)
pm2 start "$APP_DIR/ecosystem.config.cjs"

# Save PM2 process list (survives reboots with pm2 startup)
pm2 save

# ----------------------------------------------------------------
# Step 6: Start / update monitoring stack (Prometheus + Grafana + Loki)
# ----------------------------------------------------------------
echo ""
echo "[6/6] Starting monitoring stack..."
docker compose -f "$APP_DIR/docker-compose.monitoring.yml" up -d --pull always
echo "Monitoring stack running."

echo ""
echo "=== Deploy Complete ==="
echo ""
echo "Services:"
pm2 list
echo ""
echo "URLs:"
echo "  Frontend:  https://arqhfront.canilgu.org"
echo "  API:       https://arqhapi.canilgu.org"
echo "  Grafana:   https://grafana.canilgu.org"
