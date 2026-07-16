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

- **`@repo/shared`** exports Zod schemas that are the *single source of truth* for all domain types (`Vehicle`, `Order`, `Solution`, `Assignment`) and API contracts.
- If a schema changes, both `apps/api` and `apps/web` see the update immediately -- or fail to compile. This is real end-to-end type safety.
- No copy-paste of `types.ts` between repos. No codegen. No drift.

## Quick Start

### Option 1: Docker Compose (recommended)

```bash
# Clone and enter the project
git clone <repo-url> && cd ArqhWebApp

# Copy Docker environment template
cp .env.docker.example .env.docker

# Build and start all services (api, worker, web, redis, mongo + monitoring)
docker compose up --build
```

| Service | URL | Purpose |
|---------|-----|---------|
| Web UI | http://localhost:5173 | Dispatch dashboard (nginx + React SPA) |
| API | http://localhost:4000 | Express API (Redis-first state) |
| Grafana | http://localhost:3001 | Pre-provisioned monitoring dashboards |
| Prometheus | http://localhost:9090 | Metrics scraping (internal) |
| Redis | localhost:6379 | Hot state + streams |
| MongoDB | localhost:27017 | Durable state |

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

| File | Used by | Notes |
|------|---------|-------|
| `.env` | Local development and production runtime | For production, inject real values through deployment secrets or host env vars. |
| `.env.docker` | `docker-compose.yml` services (`api`, `worker`, `web`) | Copy from `.env.docker.example`; uses Docker service hostnames (`redis`, `mongo`). |
| `.env.test` | `bun run test` (API integration tests) | Loaded automatically by `apps/api/package.json` via `--env-file=../../.env.test`. |

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

| Decision | Rationale |
|----------|-----------|
| **Bun monorepo** with `workspace:*` | Shared types, single `docker compose up`, no codegen |
| **Redis-first** writes | Sub-ms latency for all dispatch mutations; Mongo only on boot + save |
| **Lua scripts** for every mutation | Atomic multi-key operations in a single round-trip; no race conditions |
| **Zod schemas = source of truth** | Types are *inferred* from schemas (DRY); runtime validation at all boundaries |
| **Hexagonal architecture** | Domain ports + infra adapters; zero coupling between layers |
| **Redis Streams** for optimization | Consumer groups, at-least-once delivery, built-in backpressure |
| **SSE** (not WebSocket) | One-way push is all we need; browser-native reconnection; simpler than WS |
| **Result\<T, E\> pattern** | No thrown exceptions in business logic; explicit error flows in type signatures |
| **Optimistic Concurrency Control** | Optional `baseRev` on every mutation prevents lost-update conflicts |

## Observability & Monitoring

The project includes a full **Prometheus + Grafana + Loki** observability stack, pre-provisioned with dashboards and datasources -- zero manual Grafana setup required.

### Metrics (Prometheus)

A lightweight `prom-client` middleware (`~0.01ms overhead per request`) records an `http_request_duration_ms` histogram with `method`, `route`, and `status_code` labels. Route labels use Express patterns (e.g., `/api/orders/:id`), not raw URLs, to prevent cardinality explosion.

The `/metrics` endpoint is mounted outside `/api/*` so it is never proxied through nginx -- only reachable within the Docker network by Prometheus.

### Pre-provisioned Grafana Dashboards

The "Arqh API Overview" dashboard ships with 5 panels ready to use:

| Panel | PromQL |
|-------|--------|
| Request Duration Heatmap | `sum(rate(http_request_duration_ms_bucket[$__rate_interval])) by (le)` |
| API Request Count by Route | `sum(rate(http_request_duration_ms_count[$__rate_interval])) by (route)` |
| Error Rate per Route (5xx) | `sum(rate(http_request_duration_ms_count{status_code=~"5.."}[$__rate_interval])) by (route)` |
| CPU & Memory Usage | `rate(process_cpu_seconds_total[1m])` + `process_resident_memory_bytes` |
| API Logs | `{service="api"} \| json` (Loki) |

### Log Aggregation (Loki + Promtail)

Promtail discovers Docker container logs automatically and ships them to Loki. Since the API uses Pino with structured JSON output, logs are queryable in Grafana with LogQL (e.g., `{service="api"} | json | level="error"`).

### Production Monitoring

A separate `docker-compose.monitoring.yml` runs the monitoring stack alongside the PM2-based API in production. Prometheus scrapes the host API via `host.docker.internal`, and Promtail reads PM2 log files instead of Docker logs.

---

## Production Deployment

The project includes a production deployment setup for bare-metal / VPS servers:

| Component | Technology | Details |
|-----------|-----------|---------|
| Process manager | PM2 | `ecosystem.config.cjs` for API + Worker |
| Web server | Nginx (host) | SSL via Let's Encrypt, SPA routing, API reverse proxy |
| Monitoring | Docker Compose | `docker-compose.monitoring.yml` (Prometheus, Grafana, Loki, Promtail) |
| Deploy | `deploy.sh` | One-script deploy: install → build → deploy static → reload nginx → restart PM2 → start monitoring |

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

GitHub Actions runs on every push and PR (`.github/workflows/ci.yml`):
- Installs dependencies with Bun
- Type-checks all workspaces (`tsc --noEmit`)
- Runs the full integration test suite against real Redis + MongoDB

The Docker integration tests (`tests/integration-docker.ts`) are excluded from CI -- they target a running Docker stack and are run manually via `bun run test:docker`.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| API Framework | Express 5 |
| Language | TypeScript (strict mode) |
| Hot State | Redis + ioredis + Lua scripting |
| Durable State | MongoDB (native driver) |
| Messaging | Redis Streams (consumer groups) |
| Real-time | Server-Sent Events (SSE) |
| Validation | Zod 4 (schema-first type inference) |
| Frontend | React 19 + Vite 7 + Zustand + TanStack Query |
| Map | React Leaflet (bonus feature) |
| Security | Helmet + CORS + express-rate-limit |
| Logging | Pino (structured JSON) |
| Observability | Prometheus + Grafana + Loki |
| Infrastructure | Docker Compose |

## License

Private -- Arqh
