# Ephemeral GitHub Actions runner for Fly Machines. One machine runs one job,
# then stops; its volume at /cache keeps Cargo, rustup, and build outputs.
ARG RUNNER_VERSION=2.338.2
FROM node:24-bookworm-slim AS node
FROM ghcr.io/actions/actions-runner:${RUNNER_VERSION}

USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential pkg-config libssl-dev clang git curl ca-certificates \
      jq unzip xz-utils perl \
 && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# Jobs inherit these, so Rust installs and builds land on the volume.
ENV CARGO_HOME=/cache/cargo \
    RUSTUP_HOME=/cache/rustup \
    CARGO_TARGET_DIR=/cache/target \
    npm_config_cache=/cache/npm \
    PLAYWRIGHT_BROWSERS_PATH=/cache/ms-playwright \
    PATH=/cache/cargo/bin:$PATH

COPY entrypoint.sh /usr/local/bin/fly-runner
ENTRYPOINT ["/usr/local/bin/fly-runner"]
