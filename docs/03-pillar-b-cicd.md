# 03 — Pillar B: Automated CI/CD Execution Pipeline

> Load when: authoring GitHub Actions workflows, optimizing Dockerfiles, or adding quality gates.
> Prereqs:   `00-overview.md`; `02-pillar-a-kubernetes.md` (images feed the chart)
> Status:    DONE ✅

## Objective (from the brief)

GitHub Actions pipeline triggering on **all PRs and merges to main**, doing:
- **Build layer optimization**: multi-stage Dockerfiles with precise layer caching, minimal base
  images (alpine/distroless), build-time args, **non-root** execution layers.
- **Quality control gates**: automated formatting, lint/style, and **container config tests** on
  every push.

## Current state (implemented)

- GitHub Actions workflows now exist:
  - `.github/workflows/ci.yml` for PR + `main` quality gates
  - `.github/workflows/build.yml` for GHCR image packaging on `main`
  - `.github/workflows/kind-smoke.yml` for kind-in-CI deploy + Pillar C smoke
- Root scripts now expose reusable gates:
  - `bun run typecheck`
  - `bun run lint`
  - `bun run format:check`
  - `bun run test`
- `.dockerignore` reduces build context size and `infra/helm/dispatch-platform/values-ci.yaml` pins
  immutable `sha-ci` image tags (never `:latest`) for helm lint/template.
- Dockerfiles remain non-root and now accept base-image build args (`BUN_IMAGE`, `NGINX_IMAGE`) so
  CI can pin/override the build inputs without changing the Dockerfiles themselves.

## Workflows (`.github/workflows/`)

### `ci.yml` — PRs + pushes to `main` (quality gates)

Jobs:
1. **typecheck-lint-format**
   - `bun install --frozen-lockfile`
   - `bun run typecheck`
   - `bun run lint`
   - `bun run format:check`
2. **dockerfile-lint**
   - `hadolint` across `apps/api/Dockerfile`, `apps/api/Dockerfile.worker`, `apps/web/Dockerfile`
3. **chart-validate**
   - `helm lint` + `helm template` + `kubeconform` for `dispatch-platform` (`values-ci.yaml`)
   - `helm dependency build` + `helm lint` for `monitoring`, and render `api-servicemonitor.yaml`
4. **api-integration-tests**
   - start `redis:7-alpine` + `mongo:7` service containers
   - run `bun run test` against `.env.test`

### `build.yml` — build & package images

- Trigger on push to `main` and `workflow_dispatch`.
- Use `docker/setup-buildx-action` + `docker/build-push-action` with `type=gha` cache per image.
- Build `api`, `worker`, and `web`; push to **GHCR** as `ghcr.io/<owner>/dispatch-<component>`.
- Tag each image with immutable `sha-<git-sha>` and `latest` on the default branch.
- Pass base-image build args so the workflow can pin/override image inputs centrally.

### `kind-smoke.yml` — kind-in-CI

- Installs kind/kubectl/helm, then runs `./run-platform.sh up` with:
  - `IMAGE_TAG=sha-<git-sha>` (immutable; no `:latest`)
  - `SKIP_MONITORING=1` (fits hosted runners; also skips monitoring pytest)
- Covers cluster-state, Ingress e2e (HTTP + SSE), and probe resilience on every PR / `main` push.

## Docker/build hardening delivered

- Keep the cache-friendly `COPY package.json` / `bun.lock` -> `bun install` -> `COPY src` layer order.
- Add `.dockerignore` to cut the build context down to app/runtime inputs.
- Keep non-root runtime layers (`USER bun` for api/worker, unprivileged nginx for web).
- Parameterize base images with `ARG` so CI can pin or override them without touching Dockerfiles.
- Defer a larger api/worker base-image redesign until size/security trade-offs are measured.

## Quality gate tools (pick + pin; log in conventions.md)

| Gate | Tool (default) | Alternative |
|------|----------------|-------------|
| Type safety | `tsc --noEmit` (Bun) | — |
| JS/TS lint | ESLint (web) | Biome |
| Format | Prettier **or** Biome | dprint |
| Dockerfile | hadolint | dockle |
| Manifests schema | kubeconform | kubeval (deprecated) |
| Manifests policy | kube-linter / conftest(OPA) | Polaris |
| Chart | `helm lint` | — |

## Definition of done

- PRs run `ci.yml` + `kind-smoke.yml`; a failing gate **blocks merge**.
- Merges to `main` build + push SHA-tagged images to GHCR with Buildx cache reuse.
- `values-ci.yaml` pins `sha-ci` tags (no `:latest`); kind-smoke overrides with the real `sha-<git-sha>`.
- Docker/build trade-offs are documented in `README.md` and `docs/conventions.md`.
