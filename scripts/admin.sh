#!/usr/bin/env bash
# Wrapper so you can run from anywhere in the repo:
#   ./scripts/admin.sh status
#   ./scripts/admin.sh trigger GFS --time 2026-02-25T18:00:00
#   ./scripts/admin.sh clear runs
#   ./scripts/admin.sh reset
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT/backend"
exec uv run python "$REPO_ROOT/scripts/admin.py" "$@"
