# AGENTS.md — Dispatch Platform Build Router

> **Purpose:** This repo is a take-home for a **Senior Platform Engineer** challenge: turn a
> provided app baseline into a production-grade **local Kubernetes** platform with CI/CD,
> infra tests, and observability. This file is the **router** — keep it loaded; pull the
> detailed doc only for the task at hand to save tokens.

## What this project is (10-second version)

A **Bun/TypeScript monorepo** (`apps/api` Express + worker, `apps/web` React, `packages/shared` Zod)
backed by **Redis** (hot state + streams) and **MongoDB** (durable state). The engineering task is
**infrastructure**, not app features: package it, run it on a local K8s cluster, scale it, test it,
and observe it.

## Routing table — load ONE doc per task

| If your task is about…                                   | Load this file                        | Status |
|----------------------------------------------------------|---------------------------------------|--------|
| Understanding the system / deliverables / vocabulary     | `docs/00-overview.md`                 | ✅ ref |
| **Platform architecture (diagrams + code map)**          | `docs/10-platform-architecture.md`    | ✅ ref |
| Making it run reproducibly (env, bootstrap, compose)     | `docs/01-project-setup.md`            | ✅ done |
| **Pillar A** — K8s topology (kind, Helm, HPA, Ingress, probes) | `docs/02-pillar-a-kubernetes.md` | ✅ done |
| **Pillar B** — CI/CD (GitHub Actions, Dockerfiles, gates) | `docs/03-pillar-b-cicd.md`           | ✅ done |
| **Pillar C** — Integration & smoke tests                 | `docs/04-pillar-c-testing.md`         | ✅ done |
| **Pillar D** — Observability (Prometheus/Grafana/Loki)   | `docs/05-pillar-d-observability.md`   | ✅ done |
| Deliverables: bootstrap script, runbook, comparison matrix | `docs/06-deliverables-runbook.md`   | ✅ done |
| Naming, labels, resource policy, decision log            | `docs/conventions.md`                 | ✅ ref |

Full index with per-file summaries: **`docs/README.md`**.

## Global invariants (always true — do not violate)

1. **Do NOT build the fullstack.** The frontend is frozen. Only package/scale/observe the
   **backend + proxy** layers. Never modify `apps/web/src` app logic.
2. **Replace, don't extend, the dev setup.** The `docker-compose.yml` baseline is a Phase-1
   convenience; the *submission* target is a Kubernetes topology (compose may be stripped).
3. **Containers run non-root** with explicit `requests`/`limits`. No `:latest` in K8s manifests.
4. **Probes are tied to backing services** (Redis/Mongo). `/api/health` returns `503` when a
   dependency is down — that is **readiness** semantics (see Pillar A for liveness split).
5. **Every non-obvious tool choice must be justified** in the README's bottom comparison matrix
   (challenge-mandated). Log decisions in `docs/conventions.md` as you go.
6. **Secrets** never committed. Real `.env*` are gitignored; only `*.example` + `.env.test` tracked.

## Default tooling decisions (change only with reason; record in conventions.md)

- Cluster: **kind** (multi-node) · Packaging: **Helm** (unified chart) · Ingress: **ingress-nginx**
- Tests: **pytest + Kubernetes Python client** for cluster state; HTTP smoke through the Ingress
- Observability: reuse the existing **Prometheus + Grafana + Loki** assets, ported into the cluster

## Build order (dependency-aware)

`01 setup (done)` → `02 Pillar A (done)` → `03 Pillar B (done)` → `04 Pillar C (done)` → `05 Pillar D (done)` → `06 deliverables/runbook (done)`
