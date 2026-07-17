# Arqh Platform — Makefile
# Thin wrapper around ./run-platform.sh so `make bootstrap` works cross-platform.
# (Windows: run under WSL2 or Git Bash, which provide make + bash.)

SHELL := /usr/bin/env bash

.DEFAULT_GOAL := help
.PHONY: help bootstrap boostrap preflight env cluster deps deploy up down smoke logs ps test compose-preflight compose-up compose-down compose-smoke compose-logs compose-ps

help: ## Show available targets
	@./run-platform.sh help

bootstrap: ## Preflight + kind cluster + deps + deploy + infra smoke
	@./run-platform.sh up

# Common typo alias
boostrap: bootstrap ## Alias for bootstrap (typo)

preflight: ## Check Kubernetes bootstrap tooling
	@./run-platform.sh preflight

env: ## Create .env / .env.docker from examples if missing
	@./run-platform.sh env

cluster: ## Create the local kind cluster
	@./run-platform.sh cluster

deps: ## Install metrics-server, ingress-nginx, and the local TLS secret
	@./run-platform.sh deps

deploy: ## Build/load images and helm install the platform
	@./run-platform.sh deploy

up: ## Bring up the Kubernetes platform end-to-end
	@./run-platform.sh up

down: ## Helm uninstall + delete the kind cluster
	@./run-platform.sh down

smoke: ## Run the Kubernetes infra smoke suite
	@./run-platform.sh smoke

logs: ## Tail cluster logs (use `make logs ARGS=api`)
	@./run-platform.sh logs $(ARGS)

ps: ## Show cluster workload status
	@./run-platform.sh ps

test: ## Run the API integration test suite (requires bun + local Redis/Mongo)
	@bun run test

compose-preflight: ## Check Docker Compose prerequisites
	@./run-platform.sh compose-preflight

compose-up: ## Start the old Docker Compose baseline
	@./run-platform.sh compose-up $(ARGS)

compose-down: ## Stop the old Docker Compose baseline
	@./run-platform.sh compose-down $(ARGS)

compose-smoke: ## Probe the old Docker Compose API health endpoint
	@./run-platform.sh compose-smoke

compose-logs: ## Tail Docker Compose logs
	@./run-platform.sh compose-logs $(ARGS)

compose-ps: ## Show Docker Compose container status
	@./run-platform.sh compose-ps $(ARGS)
