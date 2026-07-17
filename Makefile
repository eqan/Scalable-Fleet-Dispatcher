# Arqh Platform — Makefile
# Thin wrapper around ./run-platform.sh so `make bootstrap` works cross-platform.
# (Windows: run under WSL2 or Git Bash, which provide make + bash.)

SHELL := /usr/bin/env bash

.DEFAULT_GOAL := help
.PHONY: help bootstrap boostrap preflight env up down smoke logs ps test

help: ## Show available targets
	@./run-platform.sh help

bootstrap: ## Preflight + build + start the full stack and wait for green
	@./run-platform.sh up

# Common typo alias
boostrap: bootstrap ## Alias for bootstrap (typo)

preflight: ## Check required tooling
	@./run-platform.sh preflight

env: ## Create .env / .env.docker from examples if missing
	@./run-platform.sh env

up: ## Start the full stack
	@./run-platform.sh up

down: ## Stop the stack (use `make down ARGS=-v` to drop volumes)
	@./run-platform.sh down $(ARGS)

smoke: ## Probe /api/health until healthy
	@./run-platform.sh smoke

logs: ## Tail logs (use `make logs ARGS=api` for one service)
	@./run-platform.sh logs $(ARGS)

ps: ## Show container status
	@./run-platform.sh ps

test: ## Run the API integration test suite (requires bun + local Redis/Mongo)
	@bun run test
