#!/usr/bin/env bash
# ================================================================
# Arqh Platform Control Script
#
# Phase 1: reproducible local baseline via Docker Compose so the
#          project runs on any machine (macOS / Linux / Windows-WSL2).
#
# Phase 2 will extend this script with Kubernetes commands
# (cluster provisioning, Helm install, smoke gates) and the
# docker-compose baseline will be superseded per the challenge brief.
#
# Usage: ./run-platform.sh <command>
#   (Windows: run under WSL2 or Git Bash.)
# ================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILE="docker-compose.yml"
DEBUG_COMPOSE_FILE="docker-compose.debug.yml"
ENV_FILE=".env.docker"

# ---- Pretty logging ----
log()  { printf '\033[1;34m[platform]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; }

# ---- Tool requirement helper ----
require() {
  local tool="$1" hint="${2:-}"
  if ! command -v "$tool" >/dev/null 2>&1; then
    err "Missing required tool: $tool"
    [ -n "$hint" ] && echo "     -> $hint"
    return 1
  fi
  return 0
}

# ---- Commands ----------------------------------------------------

cmd_preflight() {
  log "Running preflight checks..."
  local ok=0

  require docker "Install Docker Desktop (macOS/Windows) or Docker Engine (Linux): https://docs.docker.com/get-docker/" || ok=1

  if command -v docker >/dev/null 2>&1; then
    if docker compose version >/dev/null 2>&1; then
      log "docker compose plugin: $(docker compose version --short 2>/dev/null || echo present)"
    else
      err "docker compose v2 plugin not found (upgrade Docker or install the compose plugin)"
      ok=1
    fi
    if ! docker info >/dev/null 2>&1; then
      err "Docker daemon is not running — start Docker Desktop / the docker service and retry"
      ok=1
    fi
  fi

  require curl "Install curl (used for the smoke health probe)" || ok=1

  if [ "$ok" -eq 0 ]; then
    log "Preflight OK ✅"
  else
    err "Preflight failed — resolve the issues above and re-run"
    return 1
  fi
}

cmd_env() {
  if [ ! -f "$ENV_FILE" ]; then
    cp .env.docker.example "$ENV_FILE"
    log "Created $ENV_FILE from .env.docker.example"
  else
    log "$ENV_FILE already exists — leaving as-is"
  fi
  if [ ! -f ".env" ]; then
    cp .env.example .env
    log "Created .env from .env.example"
  else
    log ".env already exists — leaving as-is"
  fi
}

cmd_up() {
  local debug=0
  for arg in "$@"; do
    [ "$arg" = "--debug" ] && debug=1
  done

  cmd_preflight
  cmd_env
  cmd_check_ports "$debug"

  local -a compose_files=(-f "$COMPOSE_FILE")
  if [ "$debug" -eq 1 ]; then
    compose_files+=(-f "$DEBUG_COMPOSE_FILE")
    log "Debug mode: also publishing redis/mongo/prometheus/loki to the host"
  fi

  log "Building images and starting the stack (api, worker, web, redis, mongo + monitoring)..."
  docker compose --env-file "$ENV_FILE" "${compose_files[@]}" up --build -d --remove-orphans
  cmd_smoke
  log "Stack is up. Web UI: http://localhost:$(get_env WEB_PORT 5173)  |  Grafana: http://localhost:$(get_env GRAFANA_PORT 3001)"
}

# Check that the host-published ports are free before we try to bind them.
# Prevents the cryptic "address already in use" failure mid-startup.
cmd_check_ports() {
  local debug="${1:-0}"
  log "Checking host port availability..."
  local conflict=0

  # var:default:label — only ports we actually publish to the host.
  local -a checks=(
    "PORT:4000:API"
    "WEB_PORT:5173:Web UI"
    "GRAFANA_PORT:3001:Grafana"
  )
  if [ "$debug" -eq 1 ]; then
    checks+=(
      "REDIS_PUBLISH_PORT:6379:Redis (debug)"
      "MONGO_PUBLISH_PORT:27017:Mongo (debug)"
      "PROMETHEUS_PUBLISH_PORT:9090:Prometheus (debug)"
      "LOKI_PUBLISH_PORT:3100:Loki (debug)"
    )
  fi

  local entry var default label port
  for entry in "${checks[@]}"; do
    IFS=: read -r var default label <<<"$entry"
    port="$(get_env "$var" "$default")"
    if port_in_use "$port"; then
      err "Port $port is already in use (needed for: $label)."
      echo "     -> free that port, or set ${var}=<other-port> in ${ENV_FILE} and re-run"
      conflict=1
    fi
  done

  if [ "$conflict" -ne 0 ]; then
    err "Resolve the port conflict(s) above and re-run. (Tip: \`lsof -nP -iTCP:<port> -sTCP:LISTEN\` shows the owner.)"
    return 1
  fi
  log "Host ports available ✅"
}

# Return 0 if a TCP port is currently listening on localhost.
port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
  else
    return 1  # no tool to check with — assume free
  fi
}

cmd_down() {
  log "Stopping the stack..."
  # Reference both files so 'down' cleans up regardless of how it was started.
  docker compose -f "$COMPOSE_FILE" -f "$DEBUG_COMPOSE_FILE" down --remove-orphans "$@"
}

cmd_smoke() {
  local port url
  port="$(get_env PORT 4000)"
  url="http://127.0.0.1:${port}/api/health"
  log "Waiting for API health at $url ..."
  for _ in $(seq 1 45); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      log "API healthy ✅"
      curl -fsS "$url"; echo
      return 0
    fi
    sleep 2
  done
  err "API did not become healthy in time. Recent status:"
  docker compose -f "$COMPOSE_FILE" ps || true
  return 1
}

cmd_logs() {
  docker compose -f "$COMPOSE_FILE" logs -f "$@"
}

cmd_ps() {
  docker compose -f "$COMPOSE_FILE" ps "$@"
}

# ---- Helpers ----------------------------------------------------

# Read KEY from .env.docker, falling back to a default.
get_env() {
  local key="$1" default="${2:-}" val=""
  if [ -f "$ENV_FILE" ]; then
    val="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | head -n1 | cut -d= -f2- || true)"
  fi
  printf '%s' "${val:-$default}"
}

usage() {
  cat <<'EOF'
Arqh Platform Control Script

Usage: ./run-platform.sh <command>

Commands:
  preflight    Check required tooling (docker, compose plugin, daemon, curl)
  env          Create .env / .env.docker from the tracked examples if missing
  up           Preflight + build + start the full stack, then wait for green
               (add --debug to also publish redis/mongo/prometheus/loki)
  bootstrap    Alias for 'up'
  smoke        Probe /api/health until the API is healthy
  down         Stop the stack (pass -v to also remove volumes)
  logs         Tail service logs (optionally a service name, e.g. logs api)
  ps           Show container status
  help         Show this message
EOF
}

main() {
  local cmd="${1:-help}"
  shift || true
  case "$cmd" in
    preflight)     cmd_preflight "$@" ;;
    env)           cmd_env "$@" ;;
    up|bootstrap)  cmd_up "$@" ;;
    smoke)         cmd_smoke "$@" ;;
    down)          cmd_down "$@" ;;
    logs)          cmd_logs "$@" ;;
    ps)            cmd_ps "$@" ;;
    help|-h|--help) usage ;;
    *) err "Unknown command: $cmd"; echo; usage; return 1 ;;
  esac
}

main "$@"
