#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_TIMEOUT_SECS=120
if [ "${CI:-}" = "true" ]; then
  # The combined pack and released-history replay suite needs its full run.
  # Compilation and tests each keep a separate bounded budget. Main's test
  # phase took about 960s of 1200s; the sea-lane voyages add replay rounds.
  DEFAULT_TIMEOUT_SECS=1800
fi
TIMEOUT_SECS="${COSYWORLD_CARGO_TIMEOUT_SECS:-$DEFAULT_TIMEOUT_SECS}"

# Known flaky tests. `test` skips them so they cannot block a merge;
# `quarantine` runs only them in CI's non-blocking job, so they still run and
# report on every push. Each has an issue and a fix-by date; remove a name
# here when its fix lands. Never delete or #[ignore] them.
QUARANTINED_TESTS=(
  divergent_capacity_processes_converge_without_affinity # #1553, fix by 2026-11-14
)

run_with_timeout() {
  local label="$1"
  shift

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
  ' "$TIMEOUT_SECS" "$@"
  local status=$?
  set -e

  if [ "$status" -eq 124 ]; then
    cat >&2 <<EOF
CosyWorld Rust check timed out while ${label} after ${TIMEOUT_SECS}s.

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

# Compiles the tests, then runs them with the given libtest arguments.
run_cargo_tests() {
  local label="$1"
  shift
  (
    cd "$ROOT/orchestrator-rust"
    export RUST_MIN_STACK="${RUST_MIN_STACK:-16777216}"
    run_with_timeout "compiling orchestrator tests" cargo test --no-run
    run_with_timeout "$label" cargo test -- "$@"
  )
}

run_tests() {
  local skips=()
  for name in ${QUARANTINED_TESTS[@]+"${QUARANTINED_TESTS[@]}"}; do
    skips+=(--skip "$name")
  done
  run_cargo_tests "running orchestrator cargo test" ${skips[@]+"${skips[@]}"}
}

run_quarantined() {
  # With no names, libtest would run every test instead of none.
  if [ "${#QUARANTINED_TESTS[@]}" -eq 0 ]; then
    echo "no quarantined orchestrator tests"
    return 0
  fi
  run_cargo_tests "running quarantined orchestrator tests" "${QUARANTINED_TESTS[@]}"
}

run_build() {
  (
    cd "$ROOT/orchestrator-rust"
    run_with_timeout "building orchestrator" cargo build
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
  quarantine)
    run_quarantined
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
    echo "Usage: check-rust.sh [fmt|test|quarantine|build|all]" >&2
    exit 2
    ;;
esac
