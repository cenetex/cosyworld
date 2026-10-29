#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_TIMEOUT_SECS=120
if [ "${CI:-}" = "true" ]; then
  # The combined pack and released-history replay suite needs its full run.
  # Compilation and tests each keep a separate bounded budget.
  DEFAULT_TIMEOUT_SECS=1200
fi
TIMEOUT_SECS="${COSYWORLD_CARGO_TIMEOUT_SECS:-$DEFAULT_TIMEOUT_SECS}"
# The full replay suite took 2,499 seconds with one test worker locally.
# Give the suite its own wall-clock budget; game operations keep their limits.
TEST_TIMEOUT_SECS="${COSYWORLD_RUST_TEST_TIMEOUT_SECS:-${COSYWORLD_CARGO_TIMEOUT_SECS:-3600}}"

run_with_timeout() {
  local label="$1"
  local timeout_secs="$2"
  shift 2

  set +e
  perl -e '
    my $timeout = shift @ARGV;
    my $pid = fork;
    die "fork failed: $!" unless defined $pid;
    if ($pid == 0) {
      exec @ARGV or die "exec failed: $!";
    }
    local $SIG{ALRM} = sub {
      kill "TERM", $pid;
      select undef, undef, undef, 0.2;
      kill "KILL", $pid;
      waitpid($pid, 0);
      exit 124;
    };
    alarm $timeout;
    waitpid($pid, 0);
    my $status = $?;
    exit(128 + ($status & 127)) if $status & 127;
    exit($status >> 8);
  ' "$timeout_secs" "$@"
  local status=$?
  set -e

  if [ "$status" -eq 124 ]; then
    cat >&2 <<EOF
CosyWorld Rust check timed out while ${label} after ${timeout_secs}s.

If Cargo is waiting on build-script-build and a process sample is parked at
_dyld_start, the local macOS dynamic loader is not starting generated native
binaries. Fix the Command Line Tools / dyld environment before trusting the
orchestrator Rust gate.
EOF
  fi

  return "$status"
}

run_fmt() {
  (
    cd "$ROOT/orchestrator-rust"
    cargo fmt --check
  )
}

run_tests() {
  (
    cd "$ROOT/orchestrator-rust"
    export RUST_MIN_STACK="${RUST_MIN_STACK:-16777216}"
    run_with_timeout "compiling orchestrator tests" "$TIMEOUT_SECS" cargo test --no-run
    run_with_timeout "running orchestrator cargo test" "$TEST_TIMEOUT_SECS" cargo test
  )
}

run_build() {
  (
    cd "$ROOT/orchestrator-rust"
    run_with_timeout "building orchestrator" "$TIMEOUT_SECS" cargo build
  )
}

case "${1:-all}" in
  fmt)
    run_fmt
    ;;
  test)
    run_fmt
    run_tests
    ;;
  build)
    run_build
    ;;
  all)
    run_fmt
    run_tests
    run_build
    ;;
  *)
    echo "Usage: check-rust.sh [fmt|test|build|all]" >&2
    exit 2
    ;;
esac
