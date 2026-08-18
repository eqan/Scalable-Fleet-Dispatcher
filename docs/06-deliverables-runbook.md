# 06 — Deliverables: Bootstrap, Runbook & Comparison Matrix

> Load when: extending the bootstrap script for K8s, writing the README runbook, or building the
>            mandatory architecture comparison matrix / preparing submission.
> Prereqs:   all pillars you've completed; `conventions.md` (decision log source)
> Status:    DONE ✅

## The four deliverables

1. **Infrastructure code repo** — Helm chart, Dockerfiles, pipeline YAMLs, infra tests. *(A–D)* ✅
2. **Unified bootstrap control script** — one command: cluster → deps → config → **green**. ✅
3. **Platform Runbook (README.md)** — setup steps, test syntax, telemetry coordinates. ✅
4. **Architecture comparison matrix** — at the **very bottom** of the README. ✅

## 1) Bootstrap control script (`run-platform.sh`)

Submission default is Kubernetes. Compose remains an explicit fallback (`compose-*`).

```
./run-platform.sh cluster     # kind create cluster --config infra/kind/kind-cluster.yaml
./run-platform.sh deps        # metrics-server + ingress-nginx + monitoring stack + TLS secrets
./run-platform.sh deploy      # build/load images + helm upgrade --install dispatch
./run-platform.sh smoke       # pytest tests/infra (cluster-state + e2e + monitoring)
./run-platform.sh up          # cluster → deps → deploy → smoke  (== make bootstrap)
./run-platform.sh down        # uninstall monitoring + app, then kind delete cluster
```

`make bootstrap` is the friendly alias. Preflight requires docker, kind, kubectl, helm, curl,
openssl, and python3 (with install hints).

## 2) Platform Runbook (README.md)

Covered in **Running on Kubernetes**:

- Prerequisites + Windows/WSL2 note
- One-command bootstrap + what "green" means
- Traffic flow through Ingress
- Operations (HPA, rolling update, probes, logs)
- **Telemetry coordinates** (Grafana URL, creds file, dashboards, PromQL/LogQL)
- Testing syntax (`make smoke` / pytest)
- Teardown (`make down`)
- Comparison matrix at the bottom

## 3) Architecture comparison matrix

Lives at the bottom of `README.md` (Pillar A + B + C + D). Source detail is in `docs/conventions.md`.

Minimum rows covered: kind, Helm, ingress-nginx, pytest, probe-resilience order, monitoring stack,
liveness split, StatefulSets, nginx-unprivileged, worker HPA, GHCR, values-ci/kind-smoke,
ServiceMonitor, Grafana host, compose fallback.

## 4) Submission checklist

Code / platform deliverables:

- [x] Helm chart, Dockerfiles, CI workflows, infra tests in-repo
- [x] `./run-platform.sh up` / `make bootstrap` path implemented
- [x] `README.md` runbook + matrix at the bottom
- [x] Infra tests include cluster, smoke, probe resilience, monitoring
- [x] Grafana + dashboards provisioned on the K8s path
- [x] kind-in-CI smoke (`kind-smoke.yml`) + `values-ci.yaml` pinned to `sha-*` (no `:latest`)
- [x] Monitoring chart lint in CI; API PDB + soft anti-affinity; NetworkPolicy allowlists

Operator / process items (do before submit):

- [ ] Private fork; access granted to **@erkul-mert** and **@CanIlgu**
- [ ] CI green on main; images pushed to GHCR
- [ ] Fresh-machine bootstrap verified once more before handoff
- [ ] Remote pointed at the handoff repository, not just a local or legacy fork
- [ ] Optional: dashboard screenshots

## Definition of done

One command on a clean machine → multi-node cluster, deps (incl. monitoring), app deployed, all
pods Ready, smoke passing, dashboards live — and the README explains + justifies all of it.
