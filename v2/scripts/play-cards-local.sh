#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

features=local-tooling
if [ "${COSYWORLD_LOCAL_BACKEND:-embedded}" = embedded ]; then
  features+=,embedded-llama
fi
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}"
export CMAKE_BUILD_PARALLEL_LEVEL="${CMAKE_BUILD_PARALLEL_LEVEL:-1}"
if [ "$#" -eq 0 ]; then
  set -- --with-voice
fi
exec cargo run --locked --release --manifest-path v2/orchestrator-rust/Cargo.toml \
  --features "$features" --bin cosyworld-orchestrator -- local "$@"
