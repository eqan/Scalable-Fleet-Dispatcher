# 02 — Pillar A: Production-Grade Kubernetes Topology

> Load when: building the cluster, Helm chart, HPA, Ingress, probes, or resource policy.
> Prereqs:   `00-overview.md`, `01-project-setup.md`, `conventions.md` (for naming/limits)
> Status:    DONE ✅

## Objective (from the brief)

Establish a **local multi-node cluster** (kind or minikube) and author a **unified Helm chart**
implementing: HPA (CPU/mem), a production Ingress (path routing, header rewrites, TLS termination),
and **resilience** — readiness/liveness probes tied to Redis/Mongo, plus explicit requests/limits.

## Decisions (defaults; justify any change in `conventions.md` → feeds README matrix)

| Choice | Default | One-line why | Alternative to document |
|--------|---------|--------------|-------------------------|
| Cluster | **kind** | Multi-node from YAML, fast, same tool in CI | minikube (VM-based, built-in addons) |
| Packaging | **Helm** | One chart, values-driven env/HPA/ingress toggles | Kustomize (patch overlays, no templating) |
| Ingress | **ingress-nginx** | Ubiquitous, best-documented, works on kind | Traefik (CRD/IngressRoute, dynamic config) |
| Backing stores | **StatefulSet + PVC** in-cluster | Self-contained local demo | Operator / external managed DB |
| Config/secrets | **ConfigMap + Secret** | Mirrors env keys from `env.ts` | Sealed-secrets / external-secrets |

## Target layout

```
infra/
├── kind/
│   └── kind-cluster.yaml          # 1 control-plane + 2 workers; extraPortMappings for ingress 80/443
└── helm/dispatch-platform/
    ├── Chart.yaml
    ├── values.yaml                # images, replicas, resources, hpa targets, ingress host/tls
    └── templates/
        ├── _helpers.tpl           # name/label helpers (see conventions.md)
        ├── configmap.yaml         # non-secret env (REDIS_HOST=redis, MONGO_URI=..., PORT, CORS…)
        ├── secret.yaml            # REDIS_PASSWORD, etc. (stringData; not committed with real values)
        ├── api-deployment.yaml    # probes + requests/limits + envFrom configmap/secret
        ├── api-service.yaml       # ClusterIP :4000
        ├── api-hpa.yaml           # CPU + memory utilization targets
        ├── worker-deployment.yaml # no Service (stream consumer); own HPA optional
        ├── worker-hpa.yaml
        ├── web-deployment.yaml    # nginx + SPA; envsubst API_HOST/API_PORT → api service
        ├── web-service.yaml       # ClusterIP :80
        ├── redis-statefulset.yaml # + headless Service, PVC
        ├── mongo-statefulset.yaml # + headless Service, PVC
        └── ingress.yaml           # path routing, rewrites, TLS secret ref
```

## Build steps (do in order)

1. **Cluster** — `infra/kind/kind-cluster.yaml`: 3 nodes; on control-plane add
   `extraPortMappings` for `80`/`443` + `node-labels: ingress-ready=true`. Create with
   `kind create cluster --config infra/kind/kind-cluster.yaml`.
2. **metrics-server** — required for HPA. kind ships without it: install and patch
   `--kubelet-insecure-tls` (document this; it's a classic HPA "unknown/`<unknown>`" gotcha).
   *(minikube alternative: `minikube addons enable metrics-server`.)*
3. **Ingress controller** — install ingress-nginx (kind provider manifest), wait for the
   controller pod Ready.
4. **Chart scaffolding** — `Chart.yaml` + `values.yaml`; wire `configmap`/`secret` via `envFrom`
   so the api/worker get the exact keys `env.ts` validates.
5. **Deployments + probes + limits** (see patterns below).
6. **Services** — ClusterIP for api/web/redis/mongo (redis/mongo headless for StatefulSet).
7. **HPA** — api + optionally worker on CPU/mem utilization.
8. **Ingress** — routes, rewrites, TLS.
9. **Install** — `helm upgrade --install dispatch infra/helm/dispatch-platform -n dispatch --create-namespace`.

## Probe design (the nuanced part — get this right)

`/api/health` pings Redis **and** Mongo, returning `200`/`503`. Use it for **readiness** so a pod
is pulled from the Service when a dependency is down. Do **not** use it for liveness, or a transient
Redis blip triggers a **restart loop**.

- **readinessProbe** → `GET /api/health` (503 when deps down = correct "stop sending traffic").
- **livenessProbe** → a dependency-free "process alive" signal. Options:
  - add a tiny `GET /api/live` returning `200` unconditionally (preferred; small app change to
    `apps/api` interface layer — allowed, it's backend/infra, not frontend), **or**
  - a `tcpSocket` check on the API port as a pragmatic no-code-change fallback.
- **startupProbe** → guard the boot hydration (`bootstrap.ts` seeds Mongo→Redis) so slow starts
  don't trip liveness; generous `failureThreshold`.

```yaml
readinessProbe:
  httpGet: { path: /api/health, port: 4000 }
  initialDelaySeconds: 5
  periodSeconds: 10
livenessProbe:
  httpGet: { path: /api/live, port: 4000 }   # or tcpSocket: { port: 4000 }
  periodSeconds: 15
  failureThreshold: 3
startupProbe:
  httpGet: { path: /api/live, port: 4000 }
  failureThreshold: 30
  periodSeconds: 2
```

For **redis/mongo** StatefulSets: `redis-cli ping` (exec) and `mongosh --eval "db.adminCommand('ping')"`
(exec) — mirrors the healthchecks already in `docker-compose.yml`.

## Requests/limits (starting point — tune with `kubectl top`)

| Workload | requests | limits |
|----------|----------|--------|
| api | 100m / 128Mi | 500m / 256Mi |
| worker | 50m / 64Mi | 250m / 128Mi |
| redis | 100m / 128Mi | 500m / 256Mi |
| mongo | 250m / 256Mi | 1000m / 512Mi |
| web (nginx) | 25m / 32Mi | 100m / 64Mi |

Rationale: limits prevent node exhaustion (brief requirement); requests enable the scheduler and
make HPA utilization meaningful (HPA % is relative to **requests**).

## HPA

- Target api on **CPU ~70%** and **memory ~80%** utilization; `minReplicas: 2`, `maxReplicas: 5`.
- Use `autoscaling/v2` (`metrics: type: Resource`). Requires metrics-server (step 2).
- Worker scaling on CPU is fine for the demo; note that true stream-lag scaling would need a custom
  metric / KEDA (call this out as a **next step** in the matrix).

## Ingress (nginx)

- Host e.g. `dispatch.localtest.me` (resolves to 127.0.0.1) or `dispatch.local` via `/etc/hosts`.
- Routing: `/api` (and `/metrics` must **not** be exposed) → api Service; `/` → web Service.
  Note current `apps/web` nginx already proxies `/api`→api; in K8s you can either keep that
  (route everything to web) or split at the Ingress (`/api`→api directly). Prefer **Ingress-level
  split** so scaling api doesn't depend on web.
- **Header rewrites**: ConfigMap + `proxy-set-headers` for `X-Forwarded-Proto/Port` (avoid
  `rewrite-target` — it would strip `/api`). Keep SSE working with `proxy-buffering: "off"` and
  long read timeouts.
- **TLS termination**: self-signed cert → `kubectl create secret tls`, reference in `ingress.tls`.
  Document the openssl one-liner in the runbook.

## Definition of done

- `kind` multi-node cluster up; ingress-nginx + metrics-server Ready.
- `helm install` yields all pods **Ready**; `kubectl get hpa` shows real (non-`<unknown>`) metrics.
- `curl -k https://<host>/api/health` through the Ingress returns `200` with redis+mongo `connected`.
- Killing a redis pod flips api **readiness** (not liveness); api recovers when redis returns.
- Decisions appended to `conventions.md`; bootstrap script updated (see `06-*`).

## Gotchas

- HPA `<unknown>` → metrics-server missing or needs `--kubelet-insecure-tls` on kind.
- `kind` can't pull local images unless you `kind load docker-image <img>` (or use a registry). CI
  builds (Pillar B) should push to a registry the cluster can reach; locally, `kind load`.
- SSE breaks if Ingress buffers responses — set the annotations above.
