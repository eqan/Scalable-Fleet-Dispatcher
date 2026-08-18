# 04 — Pillar C: Automated Integration & Smoke Testing

> Load when: writing post-deploy infrastructure tests (cluster-state validation or e2e smoke).
> Prereqs:   `02-pillar-a-kubernetes.md` (what to assert against); `00-overview.md`
> Status:    DONE ✅

## Objective (from the brief)

Write **programmatic infrastructure tests** that run **post-deployment** (not app-logic tests):
- **Cluster State Validation**: pods initialize correctly, secrets mapped safely, configs match
  expectation. Tools: Python + Kubernetes API client (pytest), Bash frameworks, or Terratest.
- **Integration/Smoke Gates**: e2e routing integrity — external HTTP/WS requests **through the
  Ingress** down to the backing stores, validating response flows.

## Decision

**Default: pytest + `kubernetes` Python client + `requests`.** Rationale: readable assertions,
first-class K8s API access, easy to run locally and in CI. Alternatives to document: pure
**Bash + kubectl/jq** (fewer deps, clunkier assertions) and **Terratest/Go** (great for Terraform,
heavier for a Helm-on-kind flow).

## Suggested layout

```
tests/infra/
├── conftest.py            # k8s client from KUBECONFIG; namespace fixture; ingress base URL
├── test_cluster_state.py  # deployments/pods/hpa/secrets/config assertions
├── test_smoke_e2e.py      # HTTP(S) + SSE through the Ingress → redis/mongo round-trip
├── requirements.txt       # kubernetes + pytest + requests
└── README.md              # how to run (mirrors runbook)
```

## Cluster-state assertions (`test_cluster_state.py`)

- **Deployments Ready**: `api`, `worker`, `web` — `status.readyReplicas == spec.replicas`.
- **StatefulSets Ready**: `redis`, `mongo` — `status.readyReplicas == 1`.
- **Probes configured**: api container has readiness (`/api/health`) **and** a dependency-free
  liveness (`/api/live` or tcpSocket) — assert they differ (guards the restart-loop mistake).
- **Requests/limits present** on every container (brief requirement; also enforced in CI policy).
- **Secrets mapped safely**: the `Secret` exists; api pod mounts it via `envFrom`; secret values are
  **not** duplicated in the ConfigMap (assert keys like `REDIS_PASSWORD` live only in the Secret).
- **Config matches expectation**: ConfigMap keys equal the set `env.ts` requires
  (`REDIS_HOST=redis`, `MONGO_URI`, `MONGO_DATABASE`, `PORT`, …).
- **HPA healthy**: `api` HPA exists and `currentMetrics` is populated (not `<unknown>` → proves
  metrics-server wired).
- **Ingress admitted**: Ingress object has an address / the controller accepted it.

## Smoke / e2e assertions (`test_smoke_e2e.py`)

Drive **through the Ingress host** (not `kubectl port-forward`) to prove routing:
- `GET /api/health` → `200`, body shows redis + mongo `connected` (proves api→both stores).
- `GET /api/state` → `200` with hydrated seed data (proves Mongo→Redis hydration path).
- A mutation round-trip, e.g. `POST /api/assign` → then `GET /api/state` reflects it (Redis write).
- **Optimize pipeline** (exercises Redis Streams + worker): `POST /api/optimize` → `202`, then poll
  `/api/state` (or consume the SSE `/api/events` stream) until the solution updates → proves
  api→`events:stream`→worker→`results:stream`→api.
- **SSE**: open `/api/events`, assert the stream stays open and pushes an event (verifies Ingress
  buffering is off — the annotation from `02-*`).
- `/metrics` is **NOT** reachable through the Ingress (negative test — it must stay internal).
- TLS: request over `https://` with the self-signed cert (allow `verify=False` locally, note it).

## Running

```bash
# after `helm install` (see 02-*)
python3 -m venv .tmp/infra-venv
.tmp/infra-venv/bin/python -m pip install -r tests/infra/requirements.txt
INGRESS_HOST=dispatch.localtest.me KUBECONFIG=~/.kube/config \
  .tmp/infra-venv/bin/python -m pytest tests/infra -v
```

Wire this as the final stage of the bootstrap script (`run-platform.sh smoke` / `make smoke`) and,
optionally, of the kind-in-CI workflow (`03-*`).

## Definition of done

- `pytest tests/infra` passes against a freshly `helm install`-ed cluster.
- Tests fail loudly and specifically when a probe is missing, a secret leaks into a ConfigMap, an
  HPA has no metrics, or the Ingress→store round-trip breaks.
- Smoke is invocable via one command and (optionally) runs in CI.
