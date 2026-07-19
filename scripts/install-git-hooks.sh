#!/usr/bin/env bash
# Install repo git hooks (pre-commit auto-format). Safe to re-run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_SRC="${ROOT}/.githooks/pre-commit"
HOOK_DST="${ROOT}/.git/hooks/pre-commit"

if [[ ! -d "${ROOT}/.git" ]]; then
  echo "Not a git checkout: ${ROOT}" >&2
  exit 1
fi

if [[ ! -f "${HOOK_SRC}" ]]; then
  echo "Missing hook source: ${HOOK_SRC}" >&2
  exit 1
fi

mkdir -p "${ROOT}/.git/hooks"
cp "${HOOK_SRC}" "${HOOK_DST}"
chmod +x "${HOOK_DST}"
echo "Installed pre-commit hook → ${HOOK_DST}"
echo "Commits that touch Prettier-scoped files will run: bun run format"
