# 01 — Project Setup (Reproducible Baseline)

> Load when: getting a fresh clone to run on any machine; touching env files, the bootstrap
>            script, the Makefile, or the docker-compose baseline / port handling.
> Prereqs:   `00-overview.md`
> Status:    DONE ✅ (Phase 1)

## Goal

A fresh clone on **macOS / Linux / Windows (WSL2)** reaches a green `/api/health` with one command,
with no undocumented prerequisites and no secrets in git.

## What exists now (delivered in Phase 1)

| Artifact | Role |
|----------|------|
| `.env.example` | Local dev template (services on `127.0.0.1`) |
| `.env.docker.example` | Compose template (service DNS: `redis`, `mongo`); host ports overridable |
| `.env.test` | Committed test config — isolated `REDIS_DB=15` + `dispatch_test` db, relaxed rate limits |
| `.gitignore` | Ignores `node_modules/`, `dist/`, real `.env*`, logs, OS/editor, challenge brief; keeps `*.example` + `.env.test` |
| `run-platform.sh` | Unified control script (preflight, env, up/bootstrap, smoke, down, logs, ps) |
| `Makefile` | `make bootstrap` etc., delegating to the script |
| `docker-compose.yml` | Baseline app + monitoring stack (Phase-1 convenience) |
| `docker-compose.debug.yml` | Opt-in overlay to publish redis/mongo/prometheus/loki to the host |

## Run it

```bash
make bootstrap          # preflight → build → start → wait for green
# equivalently:
./run-platform.sh up
```

Other commands: `make preflight | env | smoke | down | logs | ps`
(`make down ARGS=-v` to drop volumes; `make logs ARGS=api` for one service.)

Host-accessible after boot: Web `http://localhost:5173` · API `http://localhost:4000` · Grafana `http://localhost:3001`.

## Required env vars (validated by `apps/api/src/config/env.ts`)

Hard-required (no defaults): `REDIS_HOST`, `MONGO_URI`, `MONGO_DATABASE`.
Others have defaults: `PORT` (4000 in compose), `REDIS_PORT`, `REDIS_DB`, `CORS_ORIGIN`,
rate-limit knobs, `SSE_REPLAY_BUFFER_SIZE`, `STATE_READ_VALIDATE`, etc. Full list in the examples.

## Design decisions worth carrying into K8s

1. **Internal services are not published to the host.** `redis`/`mongo`/`prometheus`/`loki` are
   `expose`-only; they talk over the compose network. This avoids clashing with a developer's local
   Redis/Mongo (the original bug). Only `api`, `web`, `grafana` bind host ports, all overridable
   (`PORT`, `WEB_PORT`, `GRAFANA_PORT`). → In K8s this maps to **ClusterIP** for backing services
   and **Ingress** for the front door.
2. **Preflight fails fast** with actionable messages (missing tool → install hint; port in use →
   which var to override). Carry this UX into the K8s bootstrap.
3. **Config comes from env, validated by Zod at boot** (`env.ts` exits non-zero on bad config).
   → In K8s, inject via **ConfigMap** (non-secret) + **Secret** (credentials); keep the same keys.
4. **`/api/health` pings Redis + Mongo**, returns `200` healthy / `503` degraded → ideal
   **readinessProbe**. See `02-*` for the liveness split.

## Cross-platform notes

- Windows: run the script under **WSL2** or **Git Bash** (it's bash; native PowerShell won't work).
  A `.devcontainer` is a possible future add for zero-setup parity (not yet added).
- The port preflight uses `lsof`, falling back to `nc`; if neither exists it assumes free.

## What Phase 1 intentionally left for later

- The compose stack is a **baseline** only. Pillar A replaces it with the Kubernetes topology;
  the bootstrap script will gain `cluster` / `deploy` / `smoke` subcommands there.
