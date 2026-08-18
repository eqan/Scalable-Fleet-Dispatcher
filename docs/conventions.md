# conventions.md — Infra Conventions & Decision Log

> Load when: you hit a naming/labeling/resource/secret question, or you make a decision that must
>            later appear in the README comparison matrix.
> Prereqs:   none
> Status:    REFERENCE (append-only decision log)

## Naming & namespaces

- Kubernetes namespace: `**dispatch**`.
- Release name (Helm): `**dispatch**`. Resources named `dispatch-<component>` via `_helpers.tpl`.
- Components: `api`, `worker`, `web`, `redis`, `mongo` (+ monitoring names from the chosen stack).

## Standard labels (every object)

```yaml
app.kubernetes.io/name: <component>        # api | worker | web | redis | mongo
app.kubernetes.io/instance: dispatch
app.kubernetes.io/part-of: dispatch-platform
app.kubernetes.io/component: backend|proxy|datastore|worker
app.kubernetes.io/managed-by: Helm
```

Selectors use `app.kubernetes.io/name` + `app.kubernetes.io/instance` only (stable subset).

## Config vs. secrets (mirror `apps/api/src/config/env.ts`)

- **ConfigMap** (non-secret): `PORT`, `ENV`, `REDIS_HOST=redis`, `REDIS_PORT`, `REDIS_DB`,
`MONGO_URI`, `MONGO_DATABASE`, `CORS_ORIGIN`, rate-limit + perf knobs.
- **Secret**: `REDIS_PASSWORD`, `REDIS_USERNAME` (if used), and any Mongo credentials.
- Inject via `envFrom: [configMapRef, secretRef]`. **Never** put secret keys in the ConfigMap
(Pillar C asserts this).
- Real secret values are **never committed**; chart ships empty/placeholder `stringData` +
`values.yaml` overrides at install time.

## Images

- Registry: **GHCR** `ghcr.io/<owner>/dispatch-<component>`.
- Tags: immutable `:<git-sha>` in manifests (via `values.yaml`); `:latest` only as a convenience on
main, **never referenced by K8s**.
- `imagePullPolicy: IfNotPresent` for `kind load`ed local images; `Always` for registry in CI.

## Resource policy

- **Every** container sets `requests` and `limits` (starting values in `02-`*; tune via `kubectl top`).
- HPA utilization targets are relative to **requests** — set requests realistically.

## Probes

- **readiness** = `/api/health` (dependency-aware, 503 when redis/mongo down).
- **liveness** = dependency-free (`/api/live` or `tcpSocket`) to avoid restart loops.
- **startup** guards boot hydration. See `02-`* for the YAML.

## Versions (pin these; fill in as chosen)


| Tool           | Version            | Notes                            |
| -------------- | ------------------ | -------------------------------- |
| kubectl        | 1.30.x             | present locally                  |
| kind           | 0.32.0             | local multi-node cluster         |
| helm           | 4.2.3              | local chart packaging + lint     |
| bun            | 1.3.14             | local scripts + CI runtime       |
| ingress-nginx  | controller-v1.11.1 | kind provider manifest           |
| metrics-server | v0.7.2             | `--kubelet-insecure-tls` on kind |
| kube-prometheus-stack | 87.16.1      | monitoring stack chart           |
| loki chart     | 7.1.0              | single-binary local Loki         |
| promtail chart | 6.17.1             | Kubernetes pod log shipping      |


## Commit / PR conventions

- Conventional-ish messages: `feat(infra):`, `fix(ci):`, `docs:`, `chore:`.
- Small PRs per pillar; CI (Pillar B) must be green before merge; branch protection on `main`.

---

## Decision log (source rows for the README comparison matrix)

Append one entry per non-obvious decision. Format:

```
### <short title>
- Date:
- Decision:
- Alternatives considered:
- Why / tradeoff:
- Limitations:
- Next step:
```

### Internal services not published to host (Phase 1)

- Decision: `redis`/`mongo`/`prometheus`/`loki` are `expose`-only in compose; only `api`/`web`/
`grafana` bind host ports, all overridable.
- Alternatives: publish everything (original) — collides with local Redis/Mongo.
- Why / tradeoff: smooth first-run UX; debug access moved to opt-in `docker-compose.debug.yml`.
- Limitations: host-run tests against Docker DBs need `--debug` or a local DB.
- Next step: in K8s these become ClusterIP; only Ingress is public.

### kind for the local cluster

- Date: 2026-07-17
- Decision: use `kind` with one control-plane node, two worker nodes, and host port mappings for `80/443`.
- Alternatives considered: minikube.
- Why / tradeoff: kind is fast, scriptable, and easy to reproduce locally and later in CI; the tradeoff is a little more manual setup for ingress and metrics-server.
- Limitations: local images must be `kind load`ed unless they are published to a reachable registry.
- Next step: add the same flow to CI once image publishing exists.

### Helm as the packaging layer

- Date: 2026-07-17
- Decision: package the platform as a single Helm chart under `infra/helm/dispatch-platform`.
- Alternatives considered: Kustomize overlays.
- Why / tradeoff: Helm keeps env, resource, ingress, and HPA knobs in one values-driven chart; the tradeoff is more templating complexity than plain YAML overlays.
- Limitations: local values currently assume kind-loaded images tagged `:local`.
- Next step: add CI values for immutable registry tags.

### Ingress-level API split with TLS

- Date: 2026-07-17
- Decision: route `/api` directly to the API service and `/` to the web service at the Ingress layer, with TLS termination and SSE-safe nginx annotations.
- Alternatives considered: send all traffic to the web service and rely on the web nginx proxy for `/api`.
- Why / tradeoff: direct API routing lets the API scale independently of the web proxy and keeps `/metrics` unexposed; the tradeoff is slightly more ingress configuration.
- Limitations: local TLS uses a self-signed certificate and the default host is `dispatch.localtest.me`.
- Next step: replace the self-signed cert flow with proper secret management in later environments.

### Ingress header rewrites via proxy-set-headers

- Date: 2026-07-18
- Decision: put a small ConfigMap next to the Ingress (`X-Forwarded-Proto` / `X-Forwarded-Port`) and wire it with `proxy-set-headers`.
- Alternatives considered: `rewrite-target` (strips `/api`); snippet annotations (often disabled on kind).
- Why / tradeoff: meets the challenge header-rewrite ask without breaking path routing.
- Limitations: static header values (fine for TLS-terminated local demo).
- Next step: cert-manager in real environments.

### Split liveness and readiness probes

- Date: 2026-07-17
- Decision: keep readiness on `/api/health` and add a dependency-free `/api/live` endpoint for liveness and startup.
- Alternatives considered: reuse `/api/health` for all probes or use only a `tcpSocket` probe.
- Why / tradeoff: the split prevents transient Redis or Mongo failures from causing restart loops while still pulling unready pods out of service; the tradeoff is one small backend endpoint added for infrastructure.
- Limitations: the manual resilience check still matters because probe configuration alone does not prove recovery behavior.
- Next step: fold the Redis-failure readiness check into the automated suite once the bootstrap flow is stable.

### Probe resilience runs last and requires multi-replica recovery

- Date: 2026-07-19
- Decision: name the Redis-kill test `test_zz_probe_resilience.py` (pytest collection order) and require several consecutive healthy ingress responses before exit.
- Alternatives considered: leave probe before smoke; treat a single `/api/health` 200 as recovered.
- Why / tradeoff: with two API replicas, one recovered pod can answer healthy while the other is still reconnecting — that flaked subsequent smoke. Ordering + consecutive checks closes the race without masking real outages.
- Limitations: consecutive samples are probabilistic coverage of both backends, not a per-pod assertion.
- Next step: optional exec into each API pod for deterministic per-replica health.

### Unprivileged nginx image for the web tier

- Date: 2026-07-17
- Decision: run the web container on `nginxinc/nginx-unprivileged` and listen on `8080`, with Services/compose mapping that port externally.
- Alternatives considered: keep the rootful `nginx:alpine` image on port `80`.
- Why / tradeoff: this satisfies the non-root container invariant across the stack; the tradeoff is a small port shift in the proxy layer.
- Limitations: any direct container health checks must now target `127.0.0.1:8080`.
- Next step: evaluate a slimmer hardened web image once the full platform path is green.

### GitHub Actions as the CI/CD engine

- Date: 2026-07-17
- Decision: Pillar B uses `ci.yml` (quality gates), `build.yml` (GHCR publish), and `kind-smoke.yml` (kind deploy + infra pytest).
- Alternatives considered: CircleCI; one monolithic workflow; full monitoring stack inside kind-smoke.
- Why / tradeoff: native status checks; kind-smoke closes the deploy loop on every PR. Monitoring is skipped in CI (`SKIP_MONITORING=1`) so the job fits GitHub-hosted runners — full observability stays on `make bootstrap`.
- Limitations: kind-smoke does not exercise Grafana/Prometheus/Loki.
- Next step: optional observability smoke if a larger runner is available.

### CI image tags without :latest

- Date: 2026-07-18
- Decision: `values-ci.yaml` pins `dispatch-*:sha-ci`; kind-smoke deploys with `IMAGE_TAG=sha-<git-sha>`.
- Alternatives considered: `:latest` in the CI overlay; pull from GHCR during PR smoke.
- Why / tradeoff: no-`:latest` invariant; kind load avoids fork GHCR permission issues.
- Limitations: `sha-ci` is a lint placeholder only.
- Next step: optionally pull GHCR SHAs on `main` after `build.yml`.

### API PDB + soft anti-affinity

- Date: 2026-07-18
- Decision: PDB `minAvailable: 1` and preferred pod anti-affinity on `kubernetes.io/hostname` for the API.
- Alternatives considered: required anti-affinity; no PDB.
- Why / tradeoff: multi-node spread + drain safety without blocking single-node CI scheduling.
- Limitations: preferred anti-affinity is best-effort under tight capacity.
- Next step: none for the local demo.

### NetworkPolicy allowlists

- Date: 2026-07-18
- Decision: NetworkPolicies for redis/mongo (api+worker only) and api/web (Ingress; API also monitoring).
- Alternatives considered: default-deny whole namespace; service mesh.
- Why / tradeoff: clear datastore isolation with minimal kind CNI surprise surface.
- Limitations: enforcement depends on the CNI; policies are still asserted in cluster-state tests.
- Next step: egress rules if the demo grows beyond Ingress/datastores.

### Prettier for repo-wide formatting checks

- Date: 2026-07-17
- Decision: gate Prettier in CI with `bun run format:check` (docs, workflows, JSON, values YAML).
- Alternatives considered: Biome / dprint; local-only formatting.
- Why / tradeoff: matches the challenge formatting gate; Helm templates stay out (Go templates break Prettier).
- Limitations: not a full TS formatter for the frozen frontend.
- Next step: keep CI as `--check` only; local `.githooks/pre-commit` auto-writes before commit.

### Hadolint and kubeconform for configuration gates

- Date: 2026-07-17
- Decision: validate Dockerfiles with hadolint and rendered manifests with `helm lint` + kubeconform.
- Alternatives considered: Dockle for images, kube-linter / conftest / Polaris for manifests.
- Why / tradeoff: hadolint and kubeconform are lightweight, actionable, and easy to run both locally and in GitHub Actions; the tradeoff is that they provide best-practice/schema coverage, not deep policy-as-code enforcement.
- Limitations: no OPA-style custom policy layer yet.
- Next step: add kube-linter or conftest if stricter manifest policy checks become necessary.

### GHCR with SHA-tagged images

- Date: 2026-07-17
- Decision: publish `api`, `worker`, and `web` to `ghcr.io/<owner>/dispatch-<component>` with immutable SHA tags and `latest` only as a convenience on `main`.
- Alternatives considered: Docker Hub or local-only `kind load`.
- Why / tradeoff: GHCR integrates with GitHub Actions permissions and gives Pillar A a CI-reachable image source; the tradeoff is registry setup and package visibility management in forks.
- Limitations: the local bootstrap still uses `:local` images for speed and offline iteration.
- Next step: wire the chart deploy flow to the SHA-tagged images in later CI smoke/deploy stages.

### kube-prometheus-stack plus Loki and Promtail

- Date: 2026-07-17
- Decision: install observability as a separate `monitoring` Helm release using `kube-prometheus-stack`, `loki`, and `promtail`.
- Alternatives considered: a hand-rolled Prometheus/Grafana/Loki deployment embedded into the app chart.
- Why / tradeoff: the stack gives cluster metrics, Prometheus Operator scraping, Grafana, and node-level signals quickly; the tradeoff is more third-party chart surface area than a custom minimal setup.
- Limitations: the bootstrap now depends on additional upstream charts and takes longer than the earlier Pillar A-only flow.
- Next step: add a kind-in-CI observability smoke path once the monitoring bootstrap is stable.

### Grafana on a separate local ingress host

- Date: 2026-07-17
- Decision: expose Grafana at `grafana.dispatch.localtest.me` with its own TLS secret and generated admin secret.
- Alternatives considered: keep Grafana internal and require `kubectl port-forward`.
- Why / tradeoff: a dedicated host makes operator access and documentation simpler, especially for screenshots and repeated local use; the tradeoff is one more TLS secret and hostname to manage.
- Limitations: local access still uses a self-signed certificate and generated credentials stored under `.tmp/`.
- Next step: revisit auth and certificate handling for non-local environments.

### ServiceMonitor for internal API metrics

- Date: 2026-07-17
- Decision: scrape the API with a `ServiceMonitor` on the internal Service instead of exposing `/metrics` through the public Ingress.
- Alternatives considered: public ingress routing for `/metrics`, or a hand-authored Prometheus scrape job outside the operator model.
- Why / tradeoff: this keeps metrics private while fitting naturally into Prometheus Operator discovery; the tradeoff is reliance on CRDs and operator-managed scrape semantics.
- Limitations: debugging scrape issues now requires understanding both Service labels and operator selectors.
- Next step: add CI-level validation for the monitoring chart and ServiceMonitor path if a kind-in-CI workflow is introduced.

### Monitoring chart dependencies fetched at bootstrap

- Date: 2026-07-17
- Decision: commit `Chart.lock` but gitignore `infra/helm/monitoring/charts/*.tgz`; run `helm dependency build` in `deps`.
- Alternatives considered: vendor the `.tgz` archives in git.
- Why / tradeoff: lockfile pins versions without bloating the repo with ~1MB of binary chart packages; first bootstrap needs network.
- Limitations: offline reinstall requires a prior `helm dependency build` cache or checking charts in locally.
- Next step: mirror chart deps in CI artifact cache if kind-in-CI becomes flaky on registry fetch.

### Grafana admin password file parsing

- Date: 2026-07-17
- Decision: generate alphanumeric passwords (strip `=/+`) and read with `sed 's/^key=//'`.
- Alternatives considered: store as JSON, or use `awk -F=`.
- Why / tradeoff: naive `awk -F=` truncates base64 values that contain `=`; stripping specials + sed keeps the simple env-file format safe.
- Limitations: password entropy is slightly lower than raw base64; still adequate for local kind.
- Next step: switch to a sealed secret / external secret for non-local envs.

### Redis Pub/Sub for multi-replica SSE

- Date: 2026-07-17
- Decision: after XADD to `sse:replay`, PUBLISH the SSE frame on `sse:live` so every API pod delivers to its local sockets.
- Alternatives considered: sticky Ingress sessions; single API replica; in-memory broadcast only.
- Why / tradeoff: HPA/minReplicas=2 otherwise drops live events when the SSE client and mutator land on different pods.
- Limitations: at-most-once live delivery under pub/sub loss; replay path still covers reconnects via the stream.
- Next step: revisit a stream consumer-group fan-out if replica count or fan-out volume grows.

### Split Compose vs K8s Grafana datasource files

- Date: 2026-07-17
- Decision: keep Compose datasources under `provisioning/datasources/`; put K8s URLs in `grafana/k8s/datasources.yaml`.
- Alternatives considered: one shared YAML folder mounted by both paths.
- Why / tradeoff: Compose mounts the whole provisioning tree; two `isDefault: true` Prometheus entries crash Grafana on boot.
- Limitations: two files to keep in sync for dashboard UIDs.
- Next step: generate both from a single template if drift becomes painful.

