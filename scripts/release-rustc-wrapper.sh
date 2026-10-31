#!/bin/sh
# Rustc wrapper for compile-release-binary.sh. The build manifest's version is
# fixed at 0.0.0; give the orchestrator crate its real release version.
set -eu
name=
prev=
for arg; do
  [ "$prev" = --crate-name ] && name=$arg
  prev=$arg
done
case "$name" in
  cosyworld_orchestrator | card_policy_lab | card_policy_mock_provider)
    version="$COSYWORLD_RELEASE_VERSION"
    core="${version%%-*}"
    export CARGO_PKG_VERSION="$version"
    export CARGO_PKG_VERSION_MAJOR="${core%%.*}"
    rest="${core#*.}"
    export CARGO_PKG_VERSION_MINOR="${rest%%.*}"
    export CARGO_PKG_VERSION_PATCH="${rest#*.}"
    case "$version" in
      *-*) export CARGO_PKG_VERSION_PRE="${version#*-}" ;;
      *) export CARGO_PKG_VERSION_PRE= ;;
    esac
    ;;
esac
exec "$@"
