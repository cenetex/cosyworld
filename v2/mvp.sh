#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$ROOT/.." && pwd)"

for file in "$PROJECT_ROOT/.env" "$PROJECT_ROOT/.env.local"; do
  if [ -f "$file" ]; then
    set +u
    set -a
    # shellcheck disable=SC1090
    source "$file"
    set +a
    set -u
  fi
done

if [ "${1:-start}" = "check" ]; then
  (
    cd "$ROOT/ai-model-rust"
    cargo fmt --check
    cargo test
    cargo build --target wasm32-unknown-unknown --release
  )
  bash "$ROOT/scripts/check-rust.sh" all
  bash "$ROOT/scripts/check-main-size.sh"
  bash "$ROOT/scripts/check-rust-lint.sh"
  exec node "$ROOT/scripts/smoke-card-narrative-contract.mjs"
fi

cd "$ROOT/orchestrator-rust"
exec cargo run --locked --bin cosyworld-orchestrator -- dev "${1:-start}"
