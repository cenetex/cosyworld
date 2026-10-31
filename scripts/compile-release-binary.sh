#!/bin/sh
# Runs inside the Dockerfile's cargo-chef toolchain image for main-push
# deploys. /src holds the orchestrator crate, /cache the saved release target
# and registry, and /out receives the binary.
set -eu

# Every commit bumps the crate version, and Cargo hashes that version into the
# crate's identity. A new identity discards rustc's incremental state. Build a
# copy whose manifest version is fixed, and let the rustc wrapper give the
# compiler the real version, so env!("CARGO_PKG_VERSION") is unchanged.
crate=/app/v2/orchestrator-rust
mkdir -p "$crate"
cp -a /src/Cargo.toml /src/Cargo.lock /src/build.rs /src/src "$crate/"
cd "$crate"
version="$(awk -F'"' '/^version = / { print $2; exit }' Cargo.toml)"
case "$version" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) echo "Unreadable crate version: $version" >&2; exit 1 ;;
esac
sed -i "0,/^version = \"$version\"\$/s//version = \"0.0.0\"/" Cargo.toml
perl -0pi -e 's/(name = "cosyworld-orchestrator"\nversion = )"[^"]*"/$1"0.0.0"/' Cargo.lock
grep -q '^version = "0.0.0"$' Cargo.toml
grep -A1 '^name = "cosyworld-orchestrator"$' Cargo.lock | grep -q '^version = "0.0.0"$'

rm -rf /usr/local/cargo/registry
ln -s /cache/registry /usr/local/cargo/registry
status=0
touch /tmp/build-started
COSYWORLD_RELEASE_VERSION="$version" RUSTC_WRAPPER=/usr/local/bin/release-rustc-wrapper \
  CARGO_TARGET_DIR=/cache/target CARGO_INCREMENTAL=1 \
  cargo build --release --locked || status=$?

if [ "$status" -eq 0 ]; then
  cp /cache/target/release/cosyworld-orchestrator /out/cosyworld-orchestrator
  # The orchestrator crate rebuilds from its incremental state on every run,
  # so its large outputs need not be saved.
  rm -f /cache/target/release/cosyworld-orchestrator \
    /cache/target/release/libcosyworld_orchestrator.rlib \
    /cache/target/release/deps/cosyworld_orchestrator-* \
    /cache/target/release/deps/libcosyworld_orchestrator-*
  # A dependency or toolchain change gives a crate a new incremental directory
  # and leaves the old one behind. Drop directories this build did not use.
  find /cache/target/release/incremental -mindepth 1 -maxdepth 1 -type d \
    ! -newer /tmp/build-started -exec rm -rf {} +
  # Rustc removes a superseded incremental session only on its next run.
  # Keep just the newest one per crate.
  for dir in /cache/target/release/incremental/*/; do
    [ -d "$dir" ] || continue
    # shellcheck disable=SC2012 # rustc names sessions s-<time>-<id>-<hash>.
    keep="$(ls -td "$dir"s-*/ | head -n 1)"
    for session in "$dir"s-*/; do
      [ -d "$session" ] && [ "$session" != "$keep" ] || continue
      rm -rf "$session" "${session%/}.lock"
    done
  done
fi
chown -R "$OWNER" /cache /out
exit "$status"
