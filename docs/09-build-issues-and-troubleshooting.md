# 09 — Build Issues & Troubleshooting Reference

> Load when: you want the full "what broke, why, and how we fixed it" trail across setup, Kubernetes,
>            testing, and CI/CD.
> Prereqs:   `01-project-setup.md`; `02-pillar-a-kubernetes.md`; `03-pillar-b-cicd.md`; `04-pillar-c-testing.md`
> Status:    REFERENCE

## Why this file exists

This repo changed in stages:

1. **Phase 1 / setup baseline** — reproducible local run with Bun + Docker Compose.
2. **Pillar A** — local Kubernetes topology with kind, Helm, Ingress, probes, and HPA.
3. **Pillar C** — post-deploy infra tests and smoke coverage.
4. **Pillar B** — GitHub Actions quality gates and image packaging.

That means the same platform was validated in different environments:

- local shell
- Docker Compose
- kind + Helm
- pytest infra tests
- GitHub Actions

Several issues only appeared in one of those layers. This file records them so the next person can
understand the build path without rediscovering the same problems.

## Fast mental model

Use this order when reasoning about failures:

1. **Tooling layer** — are `bun`, `helm`, `kind`, `kubectl`, `python3`, Docker installed?
2. **Config layer** — do `.env*`, Helm values, ConfigMaps, and Secrets match the app's expected keys?
3. **Runtime layer** — do API, worker, web, Redis, and Mongo actually start and talk to each other?
4. **Cluster layer** — are probes, Ingress, Services, StatefulSets, and HPA wired correctly?
5. **Test layer** — do the smoke/integration tests assert the right behavior?
6. **CI layer** — do the local assumptions still hold inside a clean GitHub runner?

If a problem appears "mysterious," it is usually because the failure belongs to a different layer
than the one being debugged.

## Issue log

Each issue below is recorded as:

- **Symptom** — what we saw
- **Root cause** — why it happened
- **Fix** — what changed
- **Takeaway** — what to remember next time

### 1. `make bootstrap` did not install missing tools

- **Stage:** setup / local bootstrap
- **Symptom:** expectation that `make bootstrap` would install tools like `bun`, `helm`, or `kind`.
- **Root cause:** the bootstrap path was written as a **preflight validator**, not a machine
  provisioner. It checked for required tools and failed with hints, but did not install them.
- **Fix:** documented the behavior clearly and extended preflight to check the full Kubernetes-era
  toolchain (`bun`, `helm`, `kind`, `kubectl`, `python3`, `openssl`) with actionable messages.
- **Takeaway:** in this repo, `bootstrap` means "bring the platform up once the machine is ready,"
  not "provision the machine itself."

### 2. Missing local tools blocked validation work

- **Stage:** local implementation / verification
- **Symptom:** commands like `helm template`, `bun run typecheck`, or CI-like validation could not run.
- **Root cause:** some required tools were not on `PATH` yet.
- **Fix:** installed the missing tools locally and then re-ran validation.
- **Takeaway:** before debugging manifests or tests, confirm the local machine can run the same
  commands the repo expects.

### 3. The app has no `/api/docs` or Swagger UI

- **Stage:** initial app verification
- **Symptom:** `/api/docs` and similar routes returned nothing useful.
- **Root cause:** the app simply does not ship OpenAPI/Swagger documentation.
- **Fix:** verified the route surface from code rather than trying to debug a non-existent docs UI.
- **Takeaway:** absence of an endpoint is not a platform bug if the app never implemented it.

### 4. System Python blocked `pytest` dependency installation

- **Stage:** Pillar C / smoke test bootstrap
- **Symptom:** `pip install` for infra-test dependencies failed on managed Python environments.
- **Root cause:** PEP 668-style system Python protections prevented mutating the global interpreter.
- **Fix:** `run-platform.sh smoke` now creates a local virtualenv at `.tmp/infra-venv` and installs
  `tests/infra/requirements.txt` there.
- **Takeaway:** infra tests should be isolated from the host Python environment.

### 5. `/api/health` was the wrong probe for liveness

- **Stage:** Pillar A / Kubernetes probes
- **Symptom:** using the dependency-aware health endpoint for every probe risked restart loops when
  Redis or Mongo had a temporary issue.
- **Root cause:** `/api/health` intentionally reports dependency state and returns `503` when backing
  services degrade; that is good for readiness, bad for liveness.
- **Fix:** added `/api/live` as a dependency-free endpoint and split readiness/liveness/startup
  probes accordingly.
- **Takeaway:** readiness answers "can this pod serve traffic now?" while liveness answers "should
  Kubernetes restart this process?"

### 6. The web container needed to run non-root

- **Stage:** Pillar A / container hardening
- **Symptom:** the original nginx serving path assumed a root-style port 80 container.
- **Root cause:** the repo-wide invariant for the submission is **non-root containers** with explicit
  resource settings.
- **Fix:** switched the web runtime image to `nginxinc/nginx-unprivileged` and moved container
  listen traffic to port `8080`, with Service / compose mapping handling the external port.
- **Takeaway:** port `80` inside a container is often a smell when non-root execution is required.

### 7. Ingress `server-snippet` was rejected by modern ingress-nginx

- **Stage:** Pillar A / Ingress security
- **Symptom:** the Ingress path for blocking `/metrics` used an annotation that newer ingress-nginx
  versions reject or disable.
- **Root cause:** `nginx.ingress.kubernetes.io/server-snippet` is commonly restricted for security.
- **Fix:** removed the snippet-based approach and relied on route design instead: `/api` goes to the
  API service, `/` goes to the web service, and `/metrics` remains internal rather than being
  explicitly blocked by a snippet.
- **Takeaway:** prefer structural routing decisions over controller-specific unsafe annotations.

### 8. The `/metrics` smoke test checked the wrong thing

- **Stage:** Pillar C / e2e smoke
- **Symptom:** the smoke test expected a 403/404 for `/metrics`, but the request sometimes returned
  the SPA HTML instead.
- **Root cause:** "not publicly exposed" does **not** necessarily mean "must return 403/404". In this
  setup, the request can legally fall through to the web app instead.
- **Fix:** changed the test to assert that the response is **not Prometheus exposition data** instead
  of asserting a specific status code.
- **Takeaway:** test the actual security property, not an incidental response code.

### 9. SSE testing failed with the original client approach

- **Stage:** Pillar C / smoke test implementation
- **Symptom:** the SSE test was brittle and depended on `sseclient-py` behavior that did not fit the
  actual response handling.
- **Root cause:** the dependency added complexity without being necessary.
- **Fix:** rewrote the test to parse `requests.Response.iter_lines()` directly and removed the
  dependency from `tests/infra/requirements.txt`.
- **Takeaway:** for simple SSE checks, raw line parsing is often more reliable than a third-party
  wrapper.

### 10. Redis-readiness degradation tests needed to tolerate connection errors

- **Stage:** Pillar C / failure-mode testing
- **Symptom:** the probe resilience test could fail noisily when Redis restarted.
- **Root cause:** when a backing pod disappears, the API may temporarily return degraded responses or
  raise transport-level request exceptions.
- **Fix:** updated the test to treat `requests.RequestException` as part of the degraded window.
- **Takeaway:** failure-injection tests must model real transient behavior, not assume only clean HTTP
  responses.

### 11. HPA metrics were not immediately populated

- **Stage:** Pillar C / cluster-state assertions
- **Symptom:** HPA assertions could report missing metrics even when the system was actually healthy.
- **Root cause:** metrics-server population is asynchronous; `currentMetrics` is not guaranteed the
  instant the HPA object exists.
- **Fix:** added polling before declaring the HPA broken.
- **Takeaway:** for distributed control-plane features, "eventually present" often matters more than
  "present on the first read."

### 12. Helm template annotations needed safer rendering

- **Stage:** Pillar A / Helm templating
- **Symptom:** multi-line Ingress annotations were not rendered reliably.
- **Root cause:** manually iterating key/value pairs can break indentation or multiline output.
- **Fix:** switched to `toYaml ... | nindent` for annotation rendering.
- **Takeaway:** if Helm is serializing YAML-like data, prefer letting Helm render the structure rather
  than manually assembling it.

### 13. Repeated `securityContext` blocks made the chart harder to maintain

- **Stage:** Pillar A / chart readability
- **Symptom:** the same container security settings were repeated across API, worker, web, Redis, and
  Mongo manifests.
- **Root cause:** the first pass optimized for speed, not reuse.
- **Fix:** moved the shared settings into a Helm helper and referenced the helper from each workload.
- **Takeaway:** infra YAML should be refactored when duplication starts hiding the important parts.

### 14. Local lint noise was partly environment-driven

- **Stage:** Pillar A / local editor diagnostics
- **Symptom:** editor diagnostics complained about `express` or built-in Node modules in files that
  were functionally valid.
- **Root cause:** local lint/type resolution in the editor did not always match the actual Bun /
  TypeScript runtime setup.
- **Fix:** relied on real command-line validation (`bun run typecheck`) rather than overfitting code
  changes to a noisy editor environment.
- **Takeaway:** distinguish between a broken build and a misconfigured editor.

### 15. Prettier cannot safely parse Helm templates as plain YAML

- **Stage:** Pillar B / formatting gates
- **Symptom:** broad YAML formatting globs failed when they reached templated Helm files under
  `infra/helm/.../templates`.
- **Root cause:** Go-templated YAML is not plain YAML; generic formatters will choke on `{{ ... }}`.
- **Fix:** limited formatting checks to plain YAML files such as `values*.yaml`, `Chart.yaml`, and
  `infra/kind/*.yaml` rather than the templated manifest directory.
- **Takeaway:** separate rendered config from source templates when choosing formatters.

### 16. CI formatting globs cannot assume gitignored docs exist

- **Stage:** Pillar B / GitHub Actions
- **Symptom:** the `Typecheck, Lint, Format` job failed in CI with Prettier reporting no files matched
  `docs/**/*.md`.
- **Root cause:** `docs/` is gitignored in this repo, so those files are not part of the clean CI
  checkout.
- **Fix:** removed the `docs/**/*.md` glob from the CI formatting scripts.
- **Takeaway:** CI can only validate files that are actually tracked and present in the checkout.

### 17. `rendered.yaml` leaked as a local validation artifact

- **Stage:** Pillar B / chart validation
- **Symptom:** `helm template ... > rendered.yaml` left an untracked file in the repo root.
- **Root cause:** local validation wrote temporary output into the workspace rather than a temp dir.
- **Fix:** deleted the stray artifact, added `rendered.yaml` to `.gitignore`, and changed the CI job
  to render into `$RUNNER_TEMP`.
- **Takeaway:** validation jobs should leave the working tree clean.

### 18. Local hadolint and CI hadolint behaved differently

- **Stage:** Pillar B / Dockerfile linting
- **Symptom:** local Dockerfile lint looked green, but GitHub Actions failed all three Dockerfile lint
  jobs with `DL3006`.
- **Root cause:** local testing used `hadolint:latest`, while the GitHub Action bundled
  `hadolint v2.12.0`. The older version did not handle `FROM ${ARG}` the same way.
- **Fix:** reproduced the failure using the CI-matching hadolint version and added targeted inline
  `# hadolint ignore=DL3006` directives above ARG-parameterized `FROM` lines.
- **Takeaway:** when a local check disagrees with CI, match the exact tool **version**, not just the
  tool name.

### 19. Hadolint inline-ignore syntax was stricter than expected

- **Stage:** Pillar B / Dockerfile linting
- **Symptom:** the first attempt at an inline ignore still failed.
- **Root cause:** `hadolint v2.12.0` did not accept extra explanatory text after
  `# hadolint ignore=DL3006`.
- **Fix:** kept the ignore line exact and moved the explanation to a separate comment above it.
- **Takeaway:** linter pragma syntax is often version-sensitive and should be tested with the exact
  CI version.

### 20. The frozen frontend and strict lint rules were in tension

- **Stage:** Pillar B / lint gate design
- **Symptom:** the web lint gate surfaced existing React-compiler / Fast Refresh / unused-variable
  issues in `apps/web/src`, even though app logic was supposed to remain frozen.
- **Root cause:** Pillar B added a quality gate to a codebase section that the platform work was not
  meant to refactor deeply.
- **Fix:** adjusted the lint configuration so the CI gate would be meaningful without forcing a large
  frontend rewrite during an infrastructure task.
- **Takeaway:** gates should enforce the intended scope of work; otherwise they block delivery for the
  wrong reasons.

### 21. Docs inside `docs/` are currently reference-only, not tracked deliverables

- **Stage:** documentation / repo hygiene
- **Symptom:** updates under `docs/` help local understanding but do not appear in a clean CI checkout.
- **Root cause:** `docs/` is ignored by `.gitignore` in this repo.
- **Fix:** kept writing local reference docs there, but avoided making CI depend on them.
- **Takeaway:** if these docs should become submission artifacts, `docs/` must stop being ignored.

### 22. Grafana sidecar provisioning conflicted with the chart's default datasource

- **Stage:** Pillar D / monitoring bootstrap
- **Symptom:** Grafana started, but datasource provisioning failed with "Only one datasource per
  organization can be marked as default."
- **Root cause:** `kube-prometheus-stack` already provisions a default Prometheus datasource, and the
  custom ConfigMap-based datasource file also marked Prometheus as default.
- **Fix:** disabled the chart's built-in default datasource provisioning and kept the repo-managed
  datasource ConfigMap as the source of truth.
- **Takeaway:** when using Grafana sidecar provisioning, check for chart defaults before layering in
  your own datasources.

### 23. Grafana 13 tried to update bundled plugins under a non-root filesystem

- **Stage:** Pillar D / monitoring bootstrap
- **Symptom:** the Grafana pod entered `CrashLoopBackOff` with permission-denied errors while trying
  to update bundled plugins like Elasticsearch and Zipkin.
- **Root cause:** Grafana 13's background plugin updater attempted to mutate files under the
  image-owned bundled plugin directory, which is incompatible with the chart's non-root runtime.
- **Fix:** disabled bundled plugin preinstall auto-update through Grafana config.
- **Takeaway:** newer upstream images may introduce startup behavior that collides with hardened
  container defaults; test the real chart/runtime, not just the manifest render.

### 25. SSE smoke timed out with multiple API replicas

- **Stage:** Pillar C / e2e through Ingress
- **Symptom:** `test_sse_stream_emits_state_change_events` failed with
  `Read timed out` on `https://dispatch.localtest.me/api/events` while other smoke tests passed.
- **Root cause (two layers):**
  1. `api.replicaCount` is 2+. SSE clients lived only in process memory, so a mutation on pod B
     never reached an SSE socket on pod A.
  2. The smoke test called `response.iter_lines()` twice (once for `connected`, once for
     `state_changed`). `requests` only allows consuming a streamed body once — the second
     iterator saw an empty/closed stream and returned immediately.
- **Fix:** fan out live SSE via Redis Pub/Sub (`sse:live`) after the replay `XADD`, and parse
  the SSE stream in a **single** `iter_lines()` loop (post the mutation after the connected
  frame, then wait for `state_changed`). Use a dedicated Session for the SSE socket.
- **Takeaway:** multi-replica realtime needs a shared bus; never iterate a streamed
  `requests` response twice.


- **Stage:** Pillar B + D / real image rebuild (also failed in GH Actions `build-push-action`)
- **Symptom:** `docker build` / Buildx failed with `base name (${NGINX_IMAGE}) should not be blank`
  plus `UndefinedArgInFrom` / `InvalidDefaultArgInFrom` warnings.
- **Root cause:** An `ARG NGINX_IMAGE=...` placed *after* the build stage's `FROM` is scoped to that
  stage. The next `FROM ${NGINX_IMAGE}` does not see it, so BuildKit resolves a blank base image.
  Re-declaring `ARG NGINX_IMAGE` between stages does **not** fix this — that instruction still
  belongs to the previous stage.
- **Fix:** declare `ARG BUN_IMAGE` and `ARG NGINX_IMAGE` **before the first `FROM` only**, then use
  `FROM ${NGINX_IMAGE}` with no mid-file redeclare. Validate with
  `docker build --build-arg NGINX_IMAGE=... -f apps/web/Dockerfile .`.
- **Takeaway:** only ARGs above the first `FROM` are visible to subsequent `FROM` lines; validate
  with a real Buildx/`docker build`, not only hadolint.

## Recommended validation order

If you want the shortest reliable validation path, use this sequence:

1. `bun run typecheck`
2. `bun run lint`
3. `bun run format:check`
4. `bun run test`
5. `helm lint infra/helm/dispatch-platform -f infra/helm/dispatch-platform/values-ci.yaml`
6. `helm template ...` + `kubeconform`
7. `actionlint`
8. `hadolint` using the **same version as CI**
9. push a PR and confirm the GitHub checks match local expectations

This order catches the cheap failures first and leaves the slower or external checks for the end.

## What this means for the final build story

The main lesson from this repo is that the platform was not blocked by one big bug. It was blocked
by **many small environment-specific assumptions**:

- local vs CI tool versions
- dependency-aware vs dependency-free health semantics
- plain YAML vs templated YAML
- tracked vs gitignored files
- host Python vs isolated virtualenv
- "not exposed" behavior vs specific status codes

Understanding those boundaries is the real build process. Once each boundary was made explicit, the
system became much easier to reason about and validate.
