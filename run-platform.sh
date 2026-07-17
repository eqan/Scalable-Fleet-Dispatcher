#!/usr/bin/env bash
# ================================================================
# Arqh Platform Control Script
#
# Submission-default path:
#   kind cluster -> ingress-nginx + metrics-server -> local image load
#   -> Helm deploy -> infra smoke tests through the Ingress.
#
# The old Docker Compose baseline remains available via explicit
# compose-* commands for local fallback / comparison.
# ================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILE="docker-compose.yml"
DEBUG_COMPOSE_FILE="docker-compose.debug.yml"
ENV_FILE=".env.docker"

KIND_CLUSTER_NAME="arqh"
KIND_CONFIG="infra/kind/kind-cluster.yaml"
K8S_NAMESPACE="arqh"
RELEASE_NAME="arqh"
CHART_DIR="infra/helm/arqh-platform"
INGRESS_HOST="${INGRESS_HOST:-arqh.localtest.me}"
TLS_SECRET_NAME="arqh-local-tls"
MONITORING_NAMESPACE="monitoring"
MONITORING_RELEASE_NAME="monitoring"
MONITORING_CHART_DIR="infra/helm/monitoring"
GRAFANA_HOST="${GRAFANA_HOST:-grafana.arqh.localtest.me}"
GRAFANA_TLS_SECRET_NAME="grafana-local-tls"
GRAFANA_ADMIN_SECRET_NAME="grafana-admin"
TLS_DIR="$ROOT_DIR/.tmp/k8s/tls"
GRAFANA_CREDS_FILE="$ROOT_DIR/.tmp/k8s/grafana-admin.env"
INFRA_VENV="$ROOT_DIR/.tmp/infra-venv"

INGRESS_NGINX_VERSION="controller-v1.11.1"
METRICS_SERVER_VERSION="v0.7.2"

API_IMAGE="arqh-api:local"
WORKER_IMAGE="arqh-worker:local"
WEB_IMAGE="arqh-web:local"

log()  { printf '\033[1;34m[platform]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; }

require() {
  local tool="$1" hint="${2:-}"
  if ! command -v "$tool" >/dev/null 2>&1; then
    err "Missing required tool: $tool"
    [ -n "$hint" ] && echo "     -> $hint"
    return 1
  fi
  return 0
}

get_env() {
  local key="$1" default="${2:-}" val=""
  if [ -f "$ENV_FILE" ]; then
    val="$(awk -F= -v key="$key" '$1 == key { print substr($0, index($0, "=") + 1); exit }' "$ENV_FILE")"
  fi
  printf '%s' "${val:-$default}"
}

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
  else
    return 1
  fi
}

cluster_exists() {
  local cluster
  while IFS= read -r cluster; do
    if [ "$cluster" = "$KIND_CLUSTER_NAME" ]; then
      return 0
    fi
  done < <(kind get clusters 2>/dev/null || true)
  return 1
}

wait_for_rollout() {
  local resource="$1"
  kubectl -n "$K8S_NAMESPACE" rollout status "$resource" --timeout=240s
}

ensure_namespace() {
  kubectl create namespace "$K8S_NAMESPACE" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
}

cmd_preflight() {
  log "Running Kubernetes preflight checks..."
  local ok=0

  require docker "Install Docker Desktop (macOS/Windows) or Docker Engine (Linux): https://docs.docker.com/get-docker/" || ok=1
  require kind "Install kind: https://kind.sigs.k8s.io/" || ok=1
  require kubectl "Install kubectl: https://kubernetes.io/docs/tasks/tools/" || ok=1
  require helm "Install Helm: https://helm.sh/docs/intro/install/" || ok=1
  require curl "Install curl (used for health and ingress probes)" || ok=1
  require openssl "Install OpenSSL (used to create the local TLS cert)" || ok=1
  require python3 "Install Python 3 (used for pytest infra smoke tests)" || ok=1

  if command -v docker >/dev/null 2>&1 && ! docker info >/dev/null 2>&1; then
    err "Docker daemon is not running — start Docker Desktop / the docker service and retry"
    ok=1
  fi
  if command -v python3 >/dev/null 2>&1 && ! python3 -m pip --version >/dev/null 2>&1; then
    err "python3 -m pip is unavailable — install pip for Python 3 and retry"
    ok=1
  fi

  if cluster_exists; then
    log "kind cluster '$KIND_CLUSTER_NAME' already exists — skipping ingress port availability check"
  else
    cmd_check_cluster_ports || ok=1
  fi

  if [ "$ok" -eq 0 ]; then
    log "Preflight OK ✅"
  else
    err "Preflight failed — resolve the issues above and re-run"
    return 1
  fi
}

cmd_compose_preflight() {
  log "Running Docker Compose preflight checks..."
  local ok=0

  require docker "Install Docker Desktop (macOS/Windows) or Docker Engine (Linux): https://docs.docker.com/get-docker/" || ok=1
  require curl "Install curl (used for the compose smoke health probe)" || ok=1

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

  if [ "$ok" -eq 0 ]; then
    log "Compose preflight OK ✅"
  else
    err "Compose preflight failed — resolve the issues above and re-run"
    return 1
  fi
}

cmd_check_cluster_ports() {
  log "Checking host ports for kind ingress..."
  local conflict=0

  for port in 80 443; do
    if port_in_use "$port"; then
      err "Port $port is already in use (required for the kind ingress front door)."
      echo "     -> free port $port or stop the conflicting service before continuing"
      conflict=1
    fi
  done

  if [ "$conflict" -ne 0 ]; then
    err "Resolve the ingress port conflict(s) above and re-run."
    return 1
  fi

  log "Ingress ports available ✅"
}

cmd_check_compose_ports() {
  local debug="${1:-0}"
  log "Checking host port availability for compose..."
  local conflict=0
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
    err "Resolve the port conflict(s) above and re-run."
    return 1
  fi

  log "Compose host ports available ✅"
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

cmd_cluster() {
  if cluster_exists; then
    log "kind cluster '$KIND_CLUSTER_NAME' already exists — reusing it"
    return 0
  fi

  log "Creating kind cluster from $KIND_CONFIG ..."
  kind create cluster --name "$KIND_CLUSTER_NAME" --config "$KIND_CONFIG"
  log "kind cluster created ✅"
}

install_metrics_server() {
  log "Installing metrics-server (${METRICS_SERVER_VERSION}) ..."
  kubectl apply -f "https://github.com/kubernetes-sigs/metrics-server/releases/download/${METRICS_SERVER_VERSION}/components.yaml" >/dev/null

  local args
  args="$(kubectl -n kube-system get deployment metrics-server -o jsonpath='{.spec.template.spec.containers[0].args}' 2>/dev/null || true)"
  if [[ "$args" != *"--kubelet-insecure-tls"* ]]; then
    kubectl -n kube-system patch deployment metrics-server --type=json \
      -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]' >/dev/null
  fi

  kubectl -n kube-system rollout status deployment/metrics-server --timeout=240s
  log "metrics-server ready ✅"
}

install_ingress_nginx() {
  log "Installing ingress-nginx (${INGRESS_NGINX_VERSION}) ..."
  kubectl apply -f "https://raw.githubusercontent.com/kubernetes/ingress-nginx/${INGRESS_NGINX_VERSION}/deploy/static/provider/kind/deploy.yaml" >/dev/null
  kubectl -n ingress-nginx rollout status deployment/ingress-nginx-controller --timeout=240s
  log "ingress-nginx ready ✅"
}

ensure_monitoring_namespace() {
  kubectl create namespace "$MONITORING_NAMESPACE" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
}

# Read KEY=VALUE where the value may itself contain '=' (e.g. base64 padding).
read_env_value() {
  local file="$1" key="$2"
  sed -n "s/^${key}=//p" "$file" | head -n1
}

ensure_tls_secret_for_host() {
  local namespace="$1"
  local secret_name="$2"
  local host="$3"
  local host_dir="${TLS_DIR}/${host}"

  mkdir -p "$host_dir"

  local cert_file="$host_dir/tls.crt"
  local key_file="$host_dir/tls.key"

  if [ ! -f "$cert_file" ] || [ ! -f "$key_file" ]; then
    log "Generating self-signed TLS cert for $host ..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
      -keyout "$key_file" \
      -out "$cert_file" \
      -subj "/CN=${host}" \
      -addext "subjectAltName=DNS:${host}" >/dev/null 2>&1
  fi

  kubectl -n "$namespace" create secret tls "$secret_name" \
    --cert="$cert_file" \
    --key="$key_file" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null

  log "TLS secret ${secret_name} ready in namespace ${namespace} ✅"
}

ensure_tls_secret() {
  ensure_tls_secret_for_host "$K8S_NAMESPACE" "$TLS_SECRET_NAME" "$INGRESS_HOST"
}

ensure_grafana_admin_secret() {
  mkdir -p "$(dirname "$GRAFANA_CREDS_FILE")"

  if [ ! -f "$GRAFANA_CREDS_FILE" ]; then
    {
      echo "admin-user=admin"
      # Avoid '=' in the password so naive KEY=VALUE parsers elsewhere stay safe;
      # still use sed -n 's/^key=//' when reading (base64 padding edge case).
      printf 'admin-password=%s\n' "$(openssl rand -base64 32 | tr -d '\n=/+')"
    } > "$GRAFANA_CREDS_FILE"
    chmod 600 "$GRAFANA_CREDS_FILE"
  fi

  local admin_user admin_password
  admin_user="$(read_env_value "$GRAFANA_CREDS_FILE" "admin-user")"
  admin_password="$(read_env_value "$GRAFANA_CREDS_FILE" "admin-password")"

  if [ -z "$admin_user" ] || [ -z "$admin_password" ]; then
    err "Grafana credentials file is missing admin-user or admin-password: $GRAFANA_CREDS_FILE"
    return 1
  fi

  kubectl -n "$MONITORING_NAMESPACE" create secret generic "$GRAFANA_ADMIN_SECRET_NAME" \
    --from-literal=admin-user="$admin_user" \
    --from-literal=admin-password="$admin_password" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null

  log "Grafana admin secret ready (creds in ${GRAFANA_CREDS_FILE}) ✅"
}

apply_monitoring_grafana_assets() {
  local datasources_file="packages/monitoring/grafana/provisioning/datasources/datasources-k8s.yml"
  local -a dashboards=(
    "api-overview.json"
    "platform-observability.json"
  )

  log "Applying Grafana datasources and dashboards ..."
  kubectl -n "$MONITORING_NAMESPACE" create configmap monitoring-grafana-datasources \
    --from-file=datasources.yaml="$datasources_file" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  kubectl -n "$MONITORING_NAMESPACE" label configmap monitoring-grafana-datasources \
    grafana_datasource=1 --overwrite >/dev/null

  local dashboard dashboard_name dashboard_path
  for dashboard in "${dashboards[@]}"; do
    dashboard_name="${dashboard%.json}"
    dashboard_path="packages/monitoring/grafana/provisioning/dashboards/${dashboard}"
    kubectl -n "$MONITORING_NAMESPACE" create configmap "monitoring-grafana-dashboard-${dashboard_name}" \
      --from-file="${dashboard}=${dashboard_path}" \
      --dry-run=client -o yaml | kubectl apply -f - >/dev/null
    kubectl -n "$MONITORING_NAMESPACE" label configmap "monitoring-grafana-dashboard-${dashboard_name}" \
      grafana_dashboard=1 --overwrite >/dev/null
    kubectl -n "$MONITORING_NAMESPACE" annotate configmap "monitoring-grafana-dashboard-${dashboard_name}" \
      grafana_folder=Arqh --overwrite >/dev/null
  done
}

wait_for_monitoring_stack() {
  kubectl -n "$MONITORING_NAMESPACE" rollout status deployment/monitoring-grafana --timeout=240s
  kubectl -n "$MONITORING_NAMESPACE" rollout status deployment/monitoring-kube-state-metrics --timeout=240s
  kubectl -n "$MONITORING_NAMESPACE" rollout status deployment/monitoring-kube-prometheus-operator --timeout=240s
  kubectl -n "$MONITORING_NAMESPACE" rollout status statefulset/monitoring-loki --timeout=240s
  kubectl -n "$MONITORING_NAMESPACE" rollout status daemonset/monitoring-promtail --timeout=240s

  for _ in $(seq 1 60); do
    if kubectl -n "$MONITORING_NAMESPACE" wait \
      --for=condition=Ready \
      pod \
      -l operator.prometheus.io/name=monitoring-kube-prometheus-prometheus \
      --timeout=5s >/dev/null 2>&1; then
      log "Prometheus pod is ready ✅"
      return 0
    fi
    sleep 2
  done

  err "Prometheus pod did not become ready in time."
  kubectl get pods -n "$MONITORING_NAMESPACE" || true
  return 1
}

install_monitoring_stack() {
  ensure_monitoring_namespace
  ensure_tls_secret_for_host "$MONITORING_NAMESPACE" "$GRAFANA_TLS_SECRET_NAME" "$GRAFANA_HOST"
  ensure_grafana_admin_secret

  log "Building monitoring chart dependencies ..."
  helm dependency build "$MONITORING_CHART_DIR" >/dev/null

  log "Installing monitoring stack into namespace ${MONITORING_NAMESPACE} ..."
  helm upgrade --install "$MONITORING_RELEASE_NAME" "$MONITORING_CHART_DIR" \
    --namespace "$MONITORING_NAMESPACE" \
    --create-namespace \
    --set "serviceMonitor.targetNamespace=${K8S_NAMESPACE}" \
    --set "serviceMonitor.targetRelease=${RELEASE_NAME}" \
    --set "kube-prometheus-stack.grafana.admin.existingSecret=${GRAFANA_ADMIN_SECRET_NAME}" \
    --set "kube-prometheus-stack.grafana.ingress.hosts[0]=${GRAFANA_HOST}" \
    --set "kube-prometheus-stack.grafana.ingress.tls[0].hosts[0]=${GRAFANA_HOST}" \
    --set "kube-prometheus-stack.grafana.ingress.tls[0].secretName=${GRAFANA_TLS_SECRET_NAME}"

  apply_monitoring_grafana_assets
  wait_for_monitoring_stack
  log "Monitoring stack ready ✅"
}

cmd_deps() {
  ensure_namespace
  ensure_monitoring_namespace
  install_metrics_server
  install_ingress_nginx
  ensure_tls_secret
  install_monitoring_stack
}

build_local_images() {
  log "Building local Docker images for kind ..."
  docker build -f apps/api/Dockerfile -t "$API_IMAGE" .
  docker build -f apps/api/Dockerfile.worker -t "$WORKER_IMAGE" .
  docker build -f apps/web/Dockerfile -t "$WEB_IMAGE" .
}

load_images_into_kind() {
  log "Loading local images into kind ..."
  kind load docker-image "$API_IMAGE" --name "$KIND_CLUSTER_NAME"
  kind load docker-image "$WORKER_IMAGE" --name "$KIND_CLUSTER_NAME"
  kind load docker-image "$WEB_IMAGE" --name "$KIND_CLUSTER_NAME"
}

wait_for_workloads() {
  wait_for_rollout deployment/"${RELEASE_NAME}-api"
  wait_for_rollout deployment/"${RELEASE_NAME}-worker"
  wait_for_rollout deployment/"${RELEASE_NAME}-web"
  wait_for_rollout statefulset/"${RELEASE_NAME}-redis"
  wait_for_rollout statefulset/"${RELEASE_NAME}-mongo"
}

cmd_deploy() {
  ensure_namespace
  build_local_images
  load_images_into_kind

  log "Deploying Helm release ${RELEASE_NAME} into namespace ${K8S_NAMESPACE} ..."
  helm upgrade --install "$RELEASE_NAME" "$CHART_DIR" \
    --namespace "$K8S_NAMESPACE" \
    --create-namespace \
    --set ingress.host="$INGRESS_HOST" \
    --set ingress.tls.secretName="$TLS_SECRET_NAME"

  wait_for_workloads
  log "Helm deployment ready ✅"
}

wait_for_ingress_health() {
  local url="https://${INGRESS_HOST}/api/health"
  log "Waiting for ingress health at $url ..."

  for _ in $(seq 1 60); do
    if curl -sk --resolve "${INGRESS_HOST}:443:127.0.0.1" "$url" >/dev/null 2>&1; then
      log "Ingress health is green ✅"
      curl -sk --resolve "${INGRESS_HOST}:443:127.0.0.1" "$url"
      echo
      return 0
    fi
    sleep 2
  done

  err "Ingress health did not become green in time."
  kubectl get pods,svc,ingress,hpa -n "$K8S_NAMESPACE" || true
  return 1
}

# Run the infra suite from an isolated venv so we never touch system Python
# (avoids PEP 668 "externally-managed" errors and needs no global pytest).
cmd_smoke() {
  wait_for_ingress_health

  if [ ! -x "$INFRA_VENV/bin/python" ]; then
    log "Creating Python venv for infra tests at $INFRA_VENV ..."
    python3 -m venv "$INFRA_VENV"
  fi

  log "Installing infra test dependencies ..."
  "$INFRA_VENV/bin/python" -m pip install --quiet --upgrade pip
  "$INFRA_VENV/bin/python" -m pip install --quiet -r tests/infra/requirements.txt

  log "Running infra tests through the ingress ..."
  INGRESS_HOST="$INGRESS_HOST" \
  GRAFANA_HOST="$GRAFANA_HOST" \
  K8S_NAMESPACE="$K8S_NAMESPACE" \
  MONITORING_NAMESPACE="$MONITORING_NAMESPACE" \
  RELEASE_NAME="$RELEASE_NAME" \
  KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config}" \
  "$INFRA_VENV/bin/python" -m pytest tests/infra -v
}

cmd_up() {
  cmd_preflight
  cmd_env
  cmd_cluster
  cmd_deps
  cmd_deploy
  cmd_smoke
  log "Platform is green. App: https://${INGRESS_HOST}  |  Grafana: https://${GRAFANA_HOST}"
}

cmd_down() {
  log "Tearing down monitoring + app Helm releases and kind cluster..."
  helm uninstall "$MONITORING_RELEASE_NAME" -n "$MONITORING_NAMESPACE" >/dev/null 2>&1 || true
  helm uninstall "$RELEASE_NAME" -n "$K8S_NAMESPACE" >/dev/null 2>&1 || true
  kind delete cluster --name "$KIND_CLUSTER_NAME" >/dev/null 2>&1 || true
  log "Cluster teardown complete ✅"
}

cmd_logs() {
  local component="${1:-api}"
  case "$component" in
    api|worker|web)
      kubectl -n "$K8S_NAMESPACE" logs deployment/"${RELEASE_NAME}-${component}" -f
      ;;
    redis|mongo)
      kubectl -n "$K8S_NAMESPACE" logs statefulset/"${RELEASE_NAME}-${component}" -f
      ;;
    grafana)
      kubectl -n "$MONITORING_NAMESPACE" logs deployment/monitoring-grafana -f
      ;;
    prometheus)
      kubectl -n "$MONITORING_NAMESPACE" logs statefulset/prometheus-monitoring-kube-prometheus-prometheus -f
      ;;
    loki)
      kubectl -n "$MONITORING_NAMESPACE" logs statefulset/monitoring-loki -f
      ;;
    *)
      err "Unknown component: $component"
      echo "     -> choose one of: api, worker, web, redis, mongo, grafana, prometheus, loki"
      return 1
      ;;
  esac
}

cmd_ps() {
  echo "== app (${K8S_NAMESPACE}) =="
  kubectl get pods,svc,ingress,hpa,deploy,statefulset -n "$K8S_NAMESPACE"
  echo
  echo "== monitoring (${MONITORING_NAMESPACE}) =="
  kubectl get pods,svc,ingress,deploy,statefulset,daemonset -n "$MONITORING_NAMESPACE"
}

cmd_compose_up() {
  local debug=0
  for arg in "$@"; do
    [ "$arg" = "--debug" ] && debug=1
  done

  cmd_compose_preflight
  cmd_env
  cmd_check_compose_ports "$debug"

  local -a compose_files=(-f "$COMPOSE_FILE")
  if [ "$debug" -eq 1 ]; then
    compose_files+=(-f "$DEBUG_COMPOSE_FILE")
    log "Debug mode: also publishing redis/mongo/prometheus/loki to the host"
  fi

  log "Building images and starting the compose stack ..."
  docker compose --env-file "$ENV_FILE" "${compose_files[@]}" up --build -d --remove-orphans
  cmd_compose_smoke
  log "Compose stack is up. Web UI: http://localhost:$(get_env WEB_PORT 5173)  |  Grafana: http://localhost:$(get_env GRAFANA_PORT 3001)"
}

cmd_compose_smoke() {
  local port url
  port="$(get_env PORT 4000)"
  url="http://127.0.0.1:${port}/api/health"
  log "Waiting for compose API health at $url ..."
  for _ in $(seq 1 45); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      log "Compose API healthy ✅"
      curl -fsS "$url"
      echo
      return 0
    fi
    sleep 2
  done

  err "Compose API did not become healthy in time. Recent status:"
  docker compose -f "$COMPOSE_FILE" ps || true
  return 1
}

cmd_compose_down() {
  log "Stopping the compose stack..."
  docker compose -f "$COMPOSE_FILE" -f "$DEBUG_COMPOSE_FILE" down --remove-orphans "$@"
}

cmd_compose_logs() {
  docker compose -f "$COMPOSE_FILE" logs -f "$@"
}

cmd_compose_ps() {
  docker compose -f "$COMPOSE_FILE" ps "$@"
}

usage() {
  cat <<'EOF'
Arqh Platform Control Script

Usage: ./run-platform.sh <command>

Submission-default Kubernetes commands:
  preflight      Check required tooling (docker, kind, kubectl, helm, curl, openssl, python3)
  env            Create .env / .env.docker from the tracked examples if missing
  cluster        Create the local kind cluster from infra/kind/kind-cluster.yaml
  deps           Install metrics-server, ingress-nginx, monitoring stack, and local TLS secrets
  deploy         Build local images, load them into kind, and helm upgrade/install the release
  smoke          Wait for ingress health, then run pytest tests/infra -v
  up             Preflight -> env -> cluster -> deps -> deploy -> smoke
  bootstrap      Alias for 'up'
  down           Uninstall monitoring + app releases, then kind delete cluster
  logs [name]    Tail logs for api|worker|web|redis|mongo|grafana|prometheus|loki (default: api)
  ps             Show app + monitoring workloads

Fallback Docker Compose commands:
  compose-preflight  Check docker / compose prerequisites for the old baseline
  compose-up         Build + start the compose stack (add --debug for extra published ports)
  compose-smoke      Probe the compose API health endpoint until green
  compose-down       Stop the compose stack (pass -v to also remove volumes)
  compose-logs       Tail compose service logs
  compose-ps         Show compose container status
EOF
}

main() {
  local cmd="${1:-help}"
  shift || true

  case "$cmd" in
    preflight)        cmd_preflight "$@" ;;
    env)              cmd_env "$@" ;;
    cluster)          cmd_cluster "$@" ;;
    deps)             cmd_deps "$@" ;;
    deploy)           cmd_deploy "$@" ;;
    smoke)            cmd_smoke "$@" ;;
    up|bootstrap)     cmd_up "$@" ;;
    down)             cmd_down "$@" ;;
    logs)             cmd_logs "$@" ;;
    ps)               cmd_ps "$@" ;;
    compose-preflight) cmd_compose_preflight "$@" ;;
    compose-up)       cmd_compose_up "$@" ;;
    compose-smoke)    cmd_compose_smoke "$@" ;;
    compose-down)     cmd_compose_down "$@" ;;
    compose-logs)     cmd_compose_logs "$@" ;;
    compose-ps)       cmd_compose_ps "$@" ;;
    help|-h|--help)   usage ;;
    *)
      err "Unknown command: $cmd"
      echo
      usage
      return 1
      ;;
  esac
}

main "$@"
