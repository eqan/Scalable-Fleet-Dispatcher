# 00 — Project Overview & Deliverables

> Load when: you need system context, the topology, the deliverables checklist, or vocabulary.
> Prereqs:   none (start here)
> Status:    REFERENCE

## The task in one paragraph

Dispatch provided an application **baseline**. Our job as platform engineers is to build a
**production-grade local Kubernetes deployment** for it: declarative manifests / a unified Helm
chart, an automated CI/CD pipeline, post-deploy infrastructure tests, and a live observability
baseline — all reproducible from a single bootstrap command, and documented in a runbook.

> ⚠️ **Brief vs. baseline mismatch (important):** the challenge prose describes Dispatch's *real*
> system as "Python microservices." The **provided baseline is a Bun/TypeScript monorepo.**
> Infrastructure treats services as containers regardless of language, so build against what's in
> this repo (Bun api + worker, React web, Redis, Mongo). Don't rewrite the app in Python.

## Application topology (what we are packaging)

> Full visual map (mermaid + code sources): **[`10-platform-architecture.md`](10-platform-architecture.md)**.

```
                 ┌─────────────┐        ┌──────────────┐        ┌──────────────┐
   Ingress  ───▶ │  web (nginx │──/api─▶│  api (Bun/    │──────▶ │   Redis      │
   (nginx)       │  + React)   │        │  Express 5)   │◀─────  │ hot state +  │
                 └─────────────┘        └──────┬───────┘        │ streams      │
                        ▲                       │                └──────┬───────┘
                        │ static SPA            │ durable                │ events/results
                        │                ┌──────▼───────┐         ┌──────▼───────┐
                        └───────────────▶│   MongoDB    │         │  worker (Bun)│
                                         │  (snapshots) │         │  optimizer   │
                                         └──────────────┘         └──────────────┘
```

- **api** (`apps/api`): Express 5 on Bun. Redis-first mutations, SSE push, `/api/health`, `/metrics`.
- **worker** (`apps/api/src/worker.ts`): consumes `events:stream`, writes `results:stream`.
- **web** (`apps/web`): React SPA served by nginx; reverse-proxies `/api` → api. **Frozen** — do not modify app logic.
- **redis**: hot state + Redis Streams (consumer groups).
- **mongo**: durable snapshots.

Key ports (baseline): api `4000`, web `5173`→80, grafana `3001`. Redis/Mongo are internal-only.

## The four pillars (→ one doc each)

- **A — Kubernetes topology**: multi-node kind, Helm chart, HPA (CPU/mem), Ingress (routing +
  rewrites + TLS), readiness/liveness probes tied to Redis/Mongo, requests/limits. → `02-*`
- **B — CI/CD**: GitHub Actions on PRs + merges; multi-stage Dockerfiles (caching, minimal base,
  build args, non-root); lint/format/config-test gates. → `03-*`
- **C — Integration & smoke testing**: programmatic cluster-state validation + e2e HTTP/WS through
  the Ingress down to the data stores. → `04-*`
- **D — Observability**: Prometheus + Grafana + Loki; dashboards for restarts, error spikes,
  capacity, dependency latency. → `05-*`

## Technical deliverables (grading surface)

- [ ] **Infra code repo** — manifests / Helm chart, optimized Dockerfiles, pipeline YAMLs. *(Pillars A–B)*
- [ ] **Unified bootstrap control script** — one command to cluster→deps→config→green. *(`06`)*
- [ ] **Platform Runbook (README.md)** — setup, test syntax, telemetry coordinates. *(`06`)*
- [ ] **Architecture comparison matrix** at the very bottom of README — every non-obvious choice,
      an alternative, tradeoffs, and next steps. *(`06`, sourced from `conventions.md`)*
- [x] **Reproducible baseline** — env templates, `run-platform.sh`, cross-platform. *(`01`, done)*

## Submission rules (don't miss these)

- Work in a **private fork**; grant access to **@erkul-mert** and **@CanIlgu**.
- Timebox 48–72h. Prometheus starter may be **stripped/replaced** with your own.

## Glossary

| Term | Meaning here |
|------|--------------|
| Hot state | Live dispatch data in Redis (sub-ms mutations via Lua) |
| Durable state | Snapshots persisted to MongoDB on save |
| Hydration | Boot-time seed Mongo → warm Redis → create stream groups (`bootstrap.ts`) |
| Rehydration guard | Middleware that rebuilds cold Redis from Mongo on demand |
| SSE | Server-Sent Events; one-way push to the browser (not WebSocket) |
| Green state | All pods Ready, Ingress routes, `/api/health` = 200 |
