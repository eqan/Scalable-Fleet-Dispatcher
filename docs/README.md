# docs/ — Agentic Build Documentation

A **task-scoped** documentation set. Each file is self-contained and declares, at the top:

```
> Load when: <trigger>
> Prereqs:   <docs to read first, if any>
> Status:    DONE | IN PROGRESS | TODO | REFERENCE
```

**Token discipline:** load the router (`/AGENTS.md`) + the single file matching your task.
Don't preload the whole folder. Files cross-link instead of duplicating content.

## Index

| # | File | Load when | Status |
|---|------|-----------|--------|
| — | [`00-overview.md`](00-overview.md) | You need system context, the topology, the deliverables checklist, or the glossary | REFERENCE |
| 10 | [`10-platform-architecture.md`](10-platform-architecture.md) | Visual architecture: mermaid diagrams, tables, tech glossary, code source map across pillars A–D | REFERENCE |
| 1 | [`01-project-setup.md`](01-project-setup.md) | Reproducible setup: env files, `run-platform.sh`, Makefile, compose baseline, port handling | DONE |
| 2 | [`02-pillar-a-kubernetes.md`](02-pillar-a-kubernetes.md) | Building the K8s topology: kind cluster, Helm chart, HPA, Ingress, probes, requests/limits | DONE |
| 3 | [`03-pillar-b-cicd.md`](03-pillar-b-cicd.md) | GitHub Actions pipeline, multi-stage Dockerfile optimization, lint/format/config gates | DONE |
| 4 | [`04-pillar-c-testing.md`](04-pillar-c-testing.md) | Post-deploy cluster-state validation + end-to-end smoke tests through the Ingress | DONE |
| 5 | [`05-pillar-d-observability.md`](05-pillar-d-observability.md) | In-cluster Prometheus/Grafana/Loki + operational dashboards | DONE |
| 6 | [`06-deliverables-runbook.md`](06-deliverables-runbook.md) | Bootstrap control script, README runbook, mandatory architecture comparison matrix, submission | DONE |
| 8 | [`08-yaml-reference.md`](08-yaml-reference.md) | Plain-language explanation of every kind/Helm YAML file created for Pillar A | REFERENCE |
| 9 | [`09-build-issues-and-troubleshooting.md`](09-build-issues-and-troubleshooting.md) | Full issue ledger across setup, K8s, testing, and CI/CD with symptom → cause → fix → takeaway | REFERENCE |
| — | [`conventions.md`](conventions.md) | Naming/labels/resource policy, chart values layout, decision log | REFERENCE |
| — | [`RESUME_PROJECT_DOCUMENTATION.md`](RESUME_PROJECT_DOCUMENTATION.md) | Full FE/BE/infra brief + diagrams + resume bullet bank (AI resume feed) | REFERENCE |

## Suggested reading paths

- **New to the repo:** `00-overview` → **`10-platform-architecture`** (diagrams) → `01-project-setup` → then the pillar you're assigned.
- **Just need to build one pillar:** router (`/AGENTS.md`) + that pillar's file. Peek at
  `conventions.md` only when you hit a naming/limits/secrets decision.
- **Debugging or learning the whole journey:** read `09-build-issues-and-troubleshooting` after the
  pillar docs.
- **Writing the final README/runbook:** `06-deliverables-runbook` (it aggregates the decision
  log from `conventions.md` into the required comparison matrix).

## Keeping docs honest

When a pillar is completed, flip its **Status** here, in `/AGENTS.md`, and in the file header,
and append the decisions you made to the log in `conventions.md`.
