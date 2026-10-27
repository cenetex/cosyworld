# syntax=docker/dockerfile:1
FROM lukemathwalker/cargo-chef:0.1.77-rust-1-bookworm AS chef

WORKDIR /app/v2/orchestrator-rust

FROM chef AS planner

COPY v2/core-c /app/v2/core-c
COPY v2/ai-model-rust /app/v2/ai-model-rust
COPY v2/orchestrator-rust /app/v2/orchestrator-rust

RUN cargo chef prepare --recipe-path /app/recipe.json

FROM chef AS dependencies

COPY --from=planner /app/recipe.json /app/recipe.json
COPY v2/core-c /app/v2/core-c
COPY v2/ai-model-rust /app/v2/ai-model-rust

# Cache third-party Rust dependencies in a separate layer.
RUN cargo chef cook --release --recipe-path /app/recipe.json

FROM dependencies AS build

ARG CARGO_BUILD_JOBS=1

COPY v2/core-c /app/v2/core-c
COPY v2/content /app/v2/content
COPY v2/content-engine-version.txt /app/v2/content-engine-version.txt
COPY v2/card-game /app/v2/card-game
COPY v2/media /app/v2/media
COPY v2/ai-model-rust /app/v2/ai-model-rust
COPY v2/orchestrator-rust /app/v2/orchestrator-rust

# Keep the complete Cargo target between builds, including fingerprints and
# local crate outputs. Seed a fresh cache from the dependency layer. Refresh
# source times so Cargo checks source copied from an older checkout as well.
# Small builders use one worker; CI can set this to match its memory budget.
RUN --mount=type=cache,id=cosyworld-release-target-v1,target=/app/v2/orchestrator-rust/target,from=dependencies,source=/app/v2/orchestrator-rust/target,sharing=locked \
  touch build.rs \
  && find src ../ai-model-rust/src ../core-c ../content ../card-game ../media -type f -exec touch {} + \
  && touch ../content-engine-version.txt \
  && CARGO_INCREMENTAL=1 CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS} cargo build --release --locked \
  && mkdir -p /app/bin \
  && cp target/release/cosyworld-orchestrator /app/bin/cosyworld-orchestrator

FROM debian:bookworm-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive
ENV COSYWORLD_V2_ADDR=0.0.0.0:3000
ENV COSYWORLD_V2_SNAPSHOT_PATH=/data/cosyworld-v2-snapshot.json
ENV COSYWORLD_V2_EVENT_DB_PATH=/data/cosyworld-v2-events.sqlite
ENV COSYWORLD_CONTENT_ROOT=/app/v2/content
ENV RUST_LOG=cosyworld_orchestrator=info,tower_http=warn

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gosu \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system cosyworld \
  && useradd --system --no-create-home --gid cosyworld --shell /usr/sbin/nologin cosyworld \
  && mkdir -p /data \
  && chown cosyworld:cosyworld /data \
  && chmod 0770 /data

COPY --from=build /app/bin/cosyworld-orchestrator /app/cosyworld-orchestrator
COPY --from=build /app/v2/content /app/v2/content
COPY models/card-policy /app/models/card-policy
COPY deploy/entrypoint.sh /app/entrypoint.sh

RUN chmod 0755 /app/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["/app/cosyworld-orchestrator"]
