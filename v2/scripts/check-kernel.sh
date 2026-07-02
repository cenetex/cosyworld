#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="${COSYWORLD_KERNEL_TEST_BIN:-${TMPDIR:-/tmp}/cosy_kernel_test}"
TIMEOUT_SECS="${COSYWORLD_KERNEL_TEST_TIMEOUT_SECS:-20}"

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
CosyWorld C kernel check timed out while ${label} after ${TIMEOUT_SECS}s.

If this happens before the test prints anything, sample the process. A stack
parked at _dyld_start means clang-built binaries are not reaching main() on
this machine, which is a local macOS Command Line Tools / dynamic-loader issue
rather than a CosyWorld kernel rule failure.
EOF
  fi

  return "$status"
}

run_with_timeout "compiling the C kernel test" \
  cc -std=c11 -Wall -Wextra \
    -I "$ROOT/core-c/include" \
    "$ROOT/core-c/src/cosy_kernel.c" \
    "$ROOT/core-c/tests/test_kernel.c" \
    -o "$BIN"

run_with_timeout "running ${BIN}" "$BIN"
