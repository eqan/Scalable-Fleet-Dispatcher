# 08 — YAML Reference (What Each File Does)

> Load when: you want a plain-language map of every YAML/template we created for Pillar A.
> Prereqs:   `02-pillar-a-kubernetes.md` (the design), `conventions.md` (naming/labels)
> Status:    REFERENCE

This document explains the infrastructure YAML files added for the Kubernetes topology. Files were
identified via `git status` and live under `infra/` (plus the modified `docker-compose.yml`).

```
infra/
├── kind/kind-cluster.yaml              # the local cluster shape
└── helm/dispatch-platform/
    ├── Chart.yaml                      # chart identity/version
    ├── values.yaml                     # all tunable settings (the "control panel")
    └── templates/                      # the manifests Helm renders + applies
        ├── _helpers.tpl                # reusable naming/label/security snippets
        ├── configmap.yaml              # non-secret env
        ├── secret.yaml                 # secret env
        ├── api-deployment.yaml         # API pods + probes
        ├── api-service.yaml            # stable network name for the API
        ├── api-hpa.yaml                # API autoscaler
        ├── worker-deployment.yaml      # optimizer worker pods
        ├── worker-hpa.yaml             # (optional) worker autoscaler
        ├── web-deployment.yaml         # nginx + React SPA pods
        ├── web-service.yaml            # stable network name for the web
        ├── redis-statefulset.yaml      # Redis + headless Service + storage
        ├── mongo-statefulset.yaml      # Mongo + headless Service + storage
        ├── api-pdb.yaml                # keep ≥1 API pod during drains
        ├── networkpolicy.yaml          # datastore + front-door allowlists
        └── ingress.yaml                # HTTPS front door + header-rewrite ConfigMap
```

## Mental model (30 seconds)

- **`kind-cluster.yaml`** describes the *machines* (nodes).
- **The Helm chart** describes the *workloads* that run on those machines.
- **`values.yaml`** is the single control panel; **`templates/`** are forms filled in from those values.
- **`_helpers.tpl`** holds snippets reused across templates so we don't repeat ourselves.

---

## 1. `infra/kind/kind-cluster.yaml` — the cluster

Defines a **multi-node** local Kubernetes cluster running inside Docker:

- **1 control-plane node** (the "brain") + **2 worker nodes** (where app pods run). Multi-node proves
  the setup behaves like a real cluster, not a single box.
- On the control-plane it sets `node-labels: ingress-ready=true` and maps host ports **80 and 443**
  into the cluster (`extraPortMappings`). That is what lets `https://dispatch.localtest.me` on your laptop
  reach the Ingress controller inside kind.

---

## 2. `Chart.yaml` — chart identity

The Helm "package label": chart `apiVersion: v2`, the chart `name`, its `version` (the chart's own
version), and `appVersion` (the app it deploys). Helm reads this to know it's a valid chart.

## 3. `values.yaml` — the control panel

Every knob lives here, so the templates stay generic and you change behavior without editing manifests:

- **Image** repositories/tags (`dispatch-api|worker|web:local`) and `imagePullPolicy`.
- **Ingress**: host, TLS secret name, and NGINX annotations (SSE-safe buffering + long timeouts).
- **Per component** (`api`, `worker`, `web`, `redis`, `mongo`): replica counts, container ports,
  `resources` (requests/limits), and where relevant `env`, `probes`, `hpa`, and `persistence` sizes.
- **secrets**: placeholder keys (`REDIS_PASSWORD`, etc.) — real values are supplied at install time,
  never committed.

Changing a value (e.g. `api.hpa.maxReplicas`) and re-running `helm upgrade` is all it takes to retune.

## 4. `templates/_helpers.tpl` — reusable snippets

Not a manifest; a library of named template fragments used by the others (DRY):

- `dispatch.fullname` / `dispatch.componentName` — consistent resource names like `dispatch-api`, `dispatch-redis`.
- `dispatch.selectorLabels` / `dispatch.commonLabels` — the standard `app.kubernetes.io/*` labels every object carries.
- `dispatch.containerSecurity` — the hardened non-root security context (runAsNonRoot, drop ALL capabilities),
  reused by all five workloads so security is identical everywhere.

---

## 5. `configmap.yaml` and `secret.yaml` — configuration vs. secrets

Two objects, deliberately separated:

- **ConfigMap** holds all **non-secret** env the API/worker need (`PORT`, `REDIS_HOST`, `MONGO_URI`,
  `MONGO_DATABASE`, `CORS_ORIGIN`, rate-limit + perf knobs). These mirror the keys `apps/api/src/config/env.ts` validates.
- **Secret** holds **sensitive** values (`REDIS_PASSWORD`, `REDIS_USERNAME`, Mongo creds).

Both are injected into containers via `envFrom`, and secrets never appear in the ConfigMap — the infra
tests assert exactly this separation.

---

## 6. Workloads

### `api-deployment.yaml` — the API
Runs `api.replicaCount` (2) API pods. Key parts:
- `envFrom` pulls in the ConfigMap + Secret.
- **Three probes (the important bit):**
  - `readinessProbe` → `/api/health` (checks Redis + Mongo; returns 503 when a dep is down, so the pod
    is pulled out of the Service).
  - `livenessProbe` → `/api/live` (dependency-free "am I alive"; a Redis blip won't restart the pod).
  - `startupProbe` → `/api/live` with a generous threshold to cover boot hydration.
- `resources` requests/limits + the shared non-root `securityContext`.

### `worker-deployment.yaml` — the optimizer
Runs the background worker that consumes Redis Streams. **No Service** (it isn't called over HTTP —
it only reads/writes Redis). Same config/secret injection and security context.

### `web-deployment.yaml` — the SPA proxy
Runs the unprivileged nginx image serving the built React app on port **8080**. Gets `API_HOST`/`API_PORT`
env so its nginx can proxy `/api`. Probes hit `/`.

### `redis-statefulset.yaml` and `mongo-statefulset.yaml` — the datastores
StatefulSets (not Deployments) because databases need **stable identity + persistent storage**:
- Each ships a **headless Service** (stable in-cluster DNS name) and a `volumeClaimTemplate` (a PVC so
  data survives pod restarts).
- Probes use exec commands (`redis-cli ping`, `mongosh ... ping`) — mirroring the compose healthchecks.

---

## 7. Services — stable addresses

- `api-service.yaml` — ClusterIP on **:4000**; the in-cluster name other pods and the Ingress use.
- `web-service.yaml` — ClusterIP on **:80**, forwarding to the web container's `:8080`.

A Service gives a fixed name/IP in front of pods that come and go (e.g. when the HPA scales the API).

## 8. Autoscaling — `api-hpa.yaml` / `worker-hpa.yaml`

HorizontalPodAutoscalers (`autoscaling/v2`) that add/remove pods based on load:
- **API HPA:** target CPU ~70% / memory ~80%, `minReplicas: 2`, `maxReplicas: 5`. Utilization is
  measured against the container **requests**, which is why requests must be set.
- **Worker HPA:** same shape but **disabled by default** (`hpa.enabled: false`) — it's templated behind
  an `if`, so it only renders when you turn it on.

## 9. `ingress.yaml` — the single front door

One file, two objects (ConfigMap + Ingress):
- **TLS termination** via the self-signed secret.
- **Path routing:** `/api` → API, `/` → web (`/metrics` stays off the public Ingress).
- **Header rewrites:** ConfigMap sets `X-Forwarded-Proto/Port`; Ingress points at it with
  `proxy-set-headers` (not path `rewrite-target`).
- **SSE annotations:** buffering off + long read/send timeouts.

---

## 10. `docker-compose.yml` (modified, not new)

Only changed so the **web** service matches the new unprivileged nginx that listens on **8080**
(host `5173` → container `8080`, and the healthcheck targets `:8080`). This keeps the compose fallback
working after the web image was hardened to run non-root.

---

## How it all connects (one request)

```
Browser ─HTTPS→ ingress.yaml ─/api→ api-service → api-deployment ─→ redis/mongo StatefulSets
                              └─/──→ web-service → web-deployment (React SPA)
values.yaml fills in every template; _helpers.tpl supplies names/labels/security;
configmap + secret feed env into the API and worker; the HPAs scale the API on load.
```
