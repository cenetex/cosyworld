#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TIMEOUT_SECS="${COSYWORLD_CARGO_TIMEOUT_SECS:-120}"

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

run_tests() {
  (
    cd "$ROOT/orchestrator-rust"
    run_with_timeout "running orchestrator cargo test" cargo test
  )
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
