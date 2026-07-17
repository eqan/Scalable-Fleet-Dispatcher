# Arqh Mission Control -- Logistics Dispatch Platform

> A senior-grade, full-stack logistics dispatch prototype built as a **Bun monorepo** with end-to-end type safety, Redis-first state management, event-driven optimization, and real-time SSE updates.

```
┌─────────────┐       ┌──────────────┐       ┌──────────────┐
│  React SPA  │──────▶│  Express API │──────▶│    Redis     │
│  (Vite/TS)  │◀──SSE─│  (Bun)       │◀──────│  (hot state) │
└─────────────┘       └──────┬───────┘       └──────┬───────┘
                             │                      │
                      ┌──────▼───────┐       ┌──────▼───────┐
                      │   MongoDB    │       │ Redis Streams │
                      │ (durable)    │       │ events/results│
                      └──────────────┘       └──────┬───────┘
                                             ┌──────▼───────┐
                                             │    Worker     │
                                             │ (optimizer)   │
                                             └──────────────┘
```

## Monorepo Structure

```
/
├── packages/
│   └── shared/              @repo/shared -- Zod schemas & inferred types
│                             Single source of truth for both API & Web
├── apps/
│   ├── api/                 Express API + Redis Lua scripts + Worker
│   └── web/                 React + Vite + Zustand + TanStack Query
│
├── packages/monitoring/
│   ├── grafana/             Pre-provisioned datasources + dashboards
│   ├── prometheus/          Scrape configs (dev + prod)
│   ├── loki/                Log aggregation config
│   └── promtail/            Log collector configs (Docker + PM2)
│
├── docker-compose.yml            Dev: app + monitoring stack
├── docker-compose.monitoring.yml Prod: monitoring only (API runs on PM2)
├── deploy.sh                     Production deployment script
├── package.json                  Bun workspace config
├── .env.example                  Local/prod environment template
├── .env.docker.example           Docker Compose environment template
└── .env.test                     Test environment file (used by API test script)
```

### Why a Monorepo?

The task specification explicitly requires **shared type definitions** between frontend and backend. A monorepo with a `packages/shared` workspace is the only clean way to achieve this without code duplication:

- **`@repo/shared`** exports Zod schemas that are the _single source of truth_ for all domain types (`Vehicle`, `Order`, `Solution`, `Assignment`) and API contracts.
- If a schema changes, both `apps/api` and `apps/web` see the update immediately -- or fail to compile. This is real end-to-end type safety.
- No copy-paste of `types.ts` between repos. No codegen. No drift.

## Running on Kubernetes (Pillar A — submission target)

The submission target is a local **multi-node Kubernetes** topology, packaged as a single Helm
chart and fronted by an Ingress. `make bootstrap` (alias for `./run-platform.sh up`) brings the
whole platform up green with one command. The Docker Compose stack in [Quick Start](#quick-start)
is retained only as a no-Kubernetes fallback (`make compose-up`).

### Prerequisites

| Tool    | Version used | Purpose                                                |
| ------- | ------------ | ------------------------------------------------------ |
| Docker  | 27.x         | Build images + run the kind nodes                      |
| kind    | 0.23+        | Local multi-node cluster (1 control-plane + 2 workers) |
| kubectl | 1.30+        | Cluster access                                         |
| Helm    | 3.15+ / 4.x  | Chart packaging + install                              |
| Python  | 3.11+        | Infra test venv (auto-created at `.tmp/infra-venv`)    |
| openssl | any          | Self-signed TLS cert for the Ingress                   |

Windows: run under WSL2 or Git Bash.

### One command to green

```bash
make bootstrap        # preflight -> kind cluster -> deps -> deploy -> infra smoke
```

This runs the stages in [`run-platform.sh`](run-platform.sh):

1. **cluster** — `kind create cluster` from [`infra/kind/kind-cluster.yaml`](infra/kind/kind-cluster.yaml) (ports 80/443 mapped).
2. **deps** — installs `metrics-server` (patched `--kubelet-insecure-tls`), `ingress-nginx`, the
   monitoring stack (`kube-prometheus-stack` + Loki + Promtail), and self-signed TLS secrets for the
   app + Grafana hosts.
3. **deploy** — builds `arqh-api|worker|web:local`, `kind load`s them, and `helm upgrade --install arqh infra/helm/arqh-platform -n arqh`.
4. **smoke** — waits for Ingress health, then runs `pytest tests/infra` from an isolated venv.

**Green** means: all pods Ready, `kubectl get hpa` shows real (non-`<unknown>`) metrics, and
`curl -k https://arqh.localtest.me/api/health` returns `200` with Redis + Mongo `connected`.
Grafana is at `https://grafana.arqh.localtest.me` (admin creds under `.tmp/k8s/grafana-admin.env`).

### Traffic flow

```
Browser ──HTTPS──▶ ingress-nginx ─┬─ /api/*  ─▶ arqh-api  (ClusterIP :4000) ─▶ Redis + Mongo
                                  └─ /        ─▶ arqh-web  (ClusterIP :80, nginx + SPA)
/metrics is served on the API root only and is NOT routed by the Ingress (stays internal).
```

### Operations

- **Scaling (HPA):** `kubectl get hpa -n arqh` — the API autoscales on CPU 70% / memory 80% (min 2, max 5).
- **Rolling update:** rebuild + `kind load`, then `helm upgrade arqh infra/helm/arqh-platform -n arqh`.
- **Inspect probes:** `kubectl describe deploy arqh-api -n arqh` — readiness `/api/health` (dependency-aware),
  liveness/startup `/api/live` (dependency-free, so a Redis blip never triggers a restart loop).
- **Status / logs:** `make ps` · `make logs ARGS=api`.

### Testing

```bash
make smoke            # wait for Ingress health, then pytest tests/infra -v (venv auto-managed)
# or directly:
INGRESS_HOST=arqh.localtest.me KUBECONFIG=~/.kube/config \
  .tmp/infra-venv/bin/python -m pytest tests/infra -v
```

- `tests/infra/test_cluster_state.py` — deployments/statefulsets Ready, split probes, requests+limits,
  ConfigMap/Secret separation, HPA metrics populated, Ingress TLS + split routing.
- `tests/infra/test_smoke_e2e.py` — health, hydration, assign round-trip, optimize pipeline, SSE, `/metrics` non-exposure.
- `tests/infra/test_probe_resilience.py` — deleting a Redis pod degrades readiness (not liveness) and recovers.
- `tests/infra/test_monitoring.py` — monitoring workloads Ready, ServiceMonitor, Grafana ingress, Prometheus scrapes `arqh-api`.

### Teardown

```bash
make down             # uninstall monitoring + app releases, then kind delete cluster
```

## Quick Start

### Option 1: Docker Compose (fallback / no-Kubernetes)

```bash
# Clone and enter the project
git clone <repo-url> && cd ArqhWebApp

# Copy Docker environment template
cp .env.docker.example .env.docker

# Build and start all services (api, worker, web, redis, mongo + monitoring)
docker compose up --build
```

| Service    | URL                   | Purpose                                |
| ---------- | --------------------- | -------------------------------------- |
| Web UI     | http://localhost:5173 | Dispatch dashboard (nginx + React SPA) |
| API        | http://localhost:4000 | Express API (Redis-first state)        |
| Grafana    | http://localhost:3001 | Pre-provisioned monitoring dashboards  |
| Prometheus | http://localhost:9090 | Metrics scraping (internal)            |
| Redis      | localhost:6379        | Hot state + streams                    |
| MongoDB    | localhost:27017       | Durable state                          |

### Option 2: Local Development

```bash
# Prerequisites: Bun >= 1.0, Redis >= 7, MongoDB >= 6

# Install all workspace dependencies from root
bun install

# Copy and configure environment
cp .env.example .env
# Edit .env with your local Redis/MongoDB connection details

# Start the API server (hot reload)
bun run dev:api

# Start the optimization worker (separate terminal)
bun run dev:worker

# Start the frontend dev server (separate terminal)
bun run dev:web
```

### Environment Files

| File          | Used by                                                | Notes                                                                              |
| ------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `.env`        | Local development and production runtime               | For production, inject real values through deployment secrets or host env vars.    |
| `.env.docker` | `docker-compose.yml` services (`api`, `worker`, `web`) | Copy from `.env.docker.example`; uses Docker service hostnames (`redis`, `mongo`). |
| `.env.test`   | `bun run test` (API integration tests)                 | Loaded automatically by `apps/api/package.json` via `--env-file=../../.env.test`.  |

### Running Tests

```bash
# Run the full API integration test suite (uses .env.test automatically)
bun run test


# Or directly from the API workspace
cd apps/api && bun run test
```

### Running Performance Benchmarks (p95/p99 + Throughput)

```bash
# Start the stack first
docker compose up --build

# Run benchmark suite and generate JSON + Markdown reports
bun apps/api/perf/run.ts

# (optional npm-style alias)
bun run perf:report

# Generate visual dashboard from JSON reports
bun run perf:viz

# Run benchmark + dashboard generation together
bun run perf:all
```

Benchmark reports are generated in:

- `apps/api/perf/reports/perf-<timestamp>.json`
- `apps/api/perf/reports/perf-<timestamp>.md`

The benchmark covers:

- `GET /api/state` hot-cache read latency
- `POST /api/assign` Redis-first mutation latency
- `POST /api/optimize` queue latency (`202 Accepted`)
- Optimization end-to-end latency (API -> stream -> worker -> Redis update)

For detailed knobs and run protocol, see:

- `apps/api/perf/README.md`

Note: development rate limits can dominate this benchmark and produce `429`-heavy reports. Use relaxed rate-limit env values for capacity measurements.

## Architecture Overview

See each app's README for deep dives:

- **[apps/api/README.md](apps/api/README.md)** -- Backend architecture, Lua scripts, Redis keyspace, hydration flow, SOLID/DRY principles
- **[apps/web/README.md](apps/web/README.md)** -- Frontend architecture, state management, SSE sync engine, component structure

### Core Data Flow

```
User Action → Frontend (optimistic UI update)
           → POST /api/assign (or /vehicles, /orders, etc.)
           → Lua script executes atomically in Redis
           → Rev incremented, SSE broadcast to all clients
           → MongoDB untouched (draft mode)

"Save Plan" → POST /api/save
           → Read full state from Redis (pipelined)
           → Write snapshot to MongoDB (durable persistence)

"Optimize"  → POST /api/optimize → 202 Accepted
           → XADD to events:stream
           → Worker: XREADGROUP → sleep + shuffle → XADD results:stream
           → API consumer: XREADGROUP → Lua update route → SSE broadcast
```

## Key Design Decisions

| Decision                            | Rationale                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| **Bun monorepo** with `workspace:*` | Shared types, single `docker compose up`, no codegen                            |
| **Redis-first** writes              | Sub-ms latency for all dispatch mutations; Mongo only on boot + save            |
| **Lua scripts** for every mutation  | Atomic multi-key operations in a single round-trip; no race conditions          |
| **Zod schemas = source of truth**   | Types are _inferred_ from schemas (DRY); runtime validation at all boundaries   |
| **Hexagonal architecture**          | Domain ports + infra adapters; zero coupling between layers                     |
| **Redis Streams** for optimization  | Consumer groups, at-least-once delivery, built-in backpressure                  |
| **SSE** (not WebSocket)             | One-way push is all we need; browser-native reconnection; simpler than WS       |
| **Result\<T, E\> pattern**          | No thrown exceptions in business logic; explicit error flows in type signatures |
| **Optimistic Concurrency Control**  | Optional `baseRev` on every mutation prevents lost-update conflicts             |

## Observability & Monitoring

### Kubernetes (submission path)

The bootstrap installs a separate Helm release from [`infra/helm/monitoring`](infra/helm/monitoring):

| Component                        | Role                                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| Prometheus Operator + Prometheus | Scrapes the API via a `ServiceMonitor` on ClusterIP `/metrics`                         |
| Grafana                          | UI at `https://grafana.arqh.localtest.me` (sidecar-provisioned datasources/dashboards) |
| Loki + Promtail                  | Pod log shipping; LogQL uses `{app="arqh-api"}`                                        |

`/api/health` also records `arqh_dependency_latency_ms` / `arqh_dependency_up` so dependency panels stay fresh without a separate probe loop.

### Compose fallback

The Compose stack still ships Prometheus + Grafana + Loki via `docker-compose.monitoring.yml` for the no-Kubernetes path.

### Metrics (Prometheus)

A lightweight `prom-client` middleware (`~0.01ms overhead per request`) records an `http_request_duration_ms` histogram with `method`, `route`, and `status_code` labels. Route labels use Express patterns (e.g., `/api/orders/:id`), not raw URLs, to prevent cardinality explosion.

The `/metrics` endpoint is mounted outside `/api/*` so it is never proxied through nginx -- only reachable within the Docker network by Prometheus.

### Pre-provisioned Grafana Dashboards

The "Arqh API Overview" dashboard ships with 5 panels ready to use:

| Panel                      | PromQL                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| Request Duration Heatmap   | `sum(rate(http_request_duration_ms_bucket[$__rate_interval])) by (le)`                       |
| API Request Count by Route | `sum(rate(http_request_duration_ms_count[$__rate_interval])) by (route)`                     |
| Error Rate per Route (5xx) | `sum(rate(http_request_duration_ms_count{status_code=~"5.."}[$__rate_interval])) by (route)` |
| CPU & Memory Usage         | `rate(process_cpu_seconds_total[1m])` + `process_resident_memory_bytes`                      |
| API Logs                   | Compose: `{service="api"} \| json` · K8s: `{app="arqh-api"} \| json` (Loki)                  |

### Log Aggregation (Loki + Promtail)

- **Compose:** Promtail discovers Docker container logs; LogQL uses `{service="api"}`.
- **Kubernetes:** Promtail DaemonSet ships pod logs; dashboards query `{app="arqh-api"}` (relabeled from `app.kubernetes.io/*`).

### Production Monitoring

A separate `docker-compose.monitoring.yml` runs the monitoring stack alongside the PM2-based API in production. Prometheus scrapes the host API via `host.docker.internal`, and Promtail reads PM2 log files instead of Docker logs.

---

## Production Deployment

The project includes a production deployment setup for bare-metal / VPS servers:

| Component       | Technology     | Details                                                                                            |
| --------------- | -------------- | -------------------------------------------------------------------------------------------------- |
| Process manager | PM2            | `ecosystem.config.cjs` for API + Worker                                                            |
| Web server      | Nginx (host)   | SSL via Let's Encrypt, SPA routing, API reverse proxy                                              |
| Monitoring      | Docker Compose | `docker-compose.monitoring.yml` (Prometheus, Grafana, Loki, Promtail)                              |
| Deploy          | `deploy.sh`    | One-script deploy: install → build → deploy static → reload nginx → restart PM2 → start monitoring |

```bash
# On the production server
bash deploy.sh
```

Security considerations:

- Prometheus, Loki, and Grafana ports bound to `127.0.0.1` only
- `/metrics` endpoint blocked on public-facing nginx vhosts
- Grafana: sign-up disabled, anonymous access disabled, strong admin password
- Grafana subdomain behind SSL (Let's Encrypt)

---

## CI

GitHub Actions now covers both **quality gates** and **image packaging**:

- **`ci.yml`** runs on pull requests and pushes to `main`:
  - installs dependencies with Bun
  - type-checks all workspaces (`bun run typecheck`)
  - runs web ESLint (`bun run lint`)
  - runs formatting checks (`bun run format:check`)
  - runs Dockerfile lint (`hadolint`)
  - lints and renders the Helm chart (`helm lint` + `kubeconform`)
  - runs the API integration suite against real Redis + MongoDB service containers (`bun run test`)

- **`build.yml`** runs on pushes to `main` and `workflow_dispatch`:
  - builds `api`, `worker`, and `web` with Docker Buildx
  - reuses GitHub Actions cache layers
  - pushes SHA-tagged images to GHCR as `ghcr.io/<owner>/arqh-<component>:sha-<git-sha>`
  - also publishes `:latest` on the default branch as a convenience tag only

The Docker integration tests (`tests/integration-docker.ts`) are excluded from CI -- they target a running Docker stack and are run manually via `bun run test:docker`.

---

## Tech Stack

| Layer          | Technology                                   |
| -------------- | -------------------------------------------- |
| Runtime        | Bun                                          |
| API Framework  | Express 5                                    |
| Language       | TypeScript (strict mode)                     |
| Hot State      | Redis + ioredis + Lua scripting              |
| Durable State  | MongoDB (native driver)                      |
| Messaging      | Redis Streams (consumer groups)              |
| Real-time      | Server-Sent Events (SSE)                     |
| Validation     | Zod 4 (schema-first type inference)          |
| Frontend       | React 19 + Vite 7 + Zustand + TanStack Query |
| Map            | React Leaflet (bonus feature)                |
| Security       | Helmet + CORS + express-rate-limit           |
| Logging        | Pino (structured JSON)                       |
| Observability  | Prometheus + Grafana + Loki                  |
| Infrastructure | Docker, kind, Helm, GitHub Actions           |

## License

Private -- Arqh

---

## Architecture Comparison Matrix (Pillar A + B + D)

Every non-obvious infrastructure decision, its chosen option, the main alternative, the trade-off,
and the next step. Decision detail lives in [`docs/conventions.md`](docs/conventions.md).

| Decision          | Chosen                                    | Alternative                        | Why chosen / trade-off                                                              | Next step                               |
| ----------------- | ----------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------- |
| Cluster           | **kind** (multi-node)                     | minikube                           | Multi-node from YAML, fast, same tool in CI; must `kind load` local images          | Reuse the same flow in CI               |
| Packaging         | **Helm** (one chart)                      | Kustomize                          | Values-driven env/HPA/ingress toggles in one place; more templating than overlays   | Add CI values for immutable SHA tags    |
| Ingress           | **ingress-nginx**                         | Traefik                            | Ubiquitous, best-documented, works on kind; snippet annotations disabled by default | —                                       |
| Ingress routing   | **Split** `/api`→api, `/`→web             | Route all to web nginx proxy       | API scales independently of web; keeps `/metrics` internal                          | —                                       |
| Backing stores    | **In-cluster StatefulSets**               | External/managed DB                | Self-contained local demo; not production HA                                        | Document managed-DB swap                |
| Config vs secrets | **ConfigMap + Secret** via `envFrom`      | Bake into image / single ConfigMap | Mirrors `env.ts` keys; secrets never leak into ConfigMap                            | Sealed/external-secrets                 |
| Liveness split    | **`/api/live`** + `/api/health` readiness | Single health probe for both       | Dependency-free liveness avoids restart loops on Redis/Mongo blips                  | —                                       |
| Web base image    | **nginx-unprivileged** (:8080)            | rootful `nginx:alpine` (:80)       | Satisfies non-root invariant across the stack; small port shift                     | Evaluate distroless                     |
| Infra tests       | **pytest + k8s client**                   | Bash + kubectl / Terratest         | Readable assertions, first-class k8s API, runs locally + CI                         | Wire into CI (Pillar B)                 |
| Worker scaling    | **CPU HPA (optional)**                    | KEDA on stream lag                 | Simple for the demo; not lag-aware                                                  | KEDA on `events:stream` lag             |
| TLS (local)       | **Self-signed secret**                    | cert-manager                       | Zero extra controllers locally; browser warning + manual cert                       | cert-manager in real envs               |
| Image tags        | **`:local` + `IfNotPresent`**             | `:latest`                          | Deterministic on kind; no `:latest` in manifests                                    | GHCR `:<git-sha>` in CI                 |
| CI/CD engine      | **GitHub Actions**                        | CircleCI / one monolithic pipeline | Native GitHub status checks and permissions; more workflow YAML to maintain         | Add kind-in-CI smoke                    |
| Formatter         | **Prettier**                              | Biome / dprint                     | Fast, predictable for docs/workflow/config files; excludes Helm templates           | Revisit broader TS formatting later     |
| Dockerfile lint   | **hadolint**                              | Dockle                             | Strong best-practice feedback with easy CI integration                              | Add image security scan if needed       |
| Manifest schema   | **helm lint + kubeconform**               | kube-linter / conftest / Polaris   | Lightweight chart+schema validation; no custom policy layer yet                     | Add policy-as-code if requirements grow |
| Registry delivery | **GHCR + SHA tags**                       | Docker Hub / local-only kind load  | Native Actions auth and immutable deploy tags; fork package visibility needs care   | Reuse GHCR images in CI smoke/deploy    |
| Observability     | **Separate monitoring Helm release**      | Embed Prometheus into app chart    | Operator CRDs + Grafana/Loki quickly; more chart surface area                       | kind-in-CI observability smoke          |
| Metrics exposure  | **ServiceMonitor (ClusterIP only)**       | Ingress `/metrics`                 | Keeps scrape private; requires Prometheus Operator                                  | —                                       |
| Grafana access    | **Dedicated ingress host + TLS**          | `kubectl port-forward` only        | Easy screenshots/demo UX; extra TLS secret + creds file under `.tmp/`               | cert-manager / SSO later                |
