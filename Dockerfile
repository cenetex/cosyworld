# syntax=docker/dockerfile:1
FROM lukemathwalker/cargo-chef:0.1.77-rust-1-bookworm AS chef

WORKDIR /app/v2/orchestrator-rust

FROM chef AS planner

COPY v2/core-c /app/v2/core-c
COPY v2/ai-model-rust /app/v2/ai-model-rust
COPY v2/orchestrator-rust /app/v2/orchestrator-rust

RUN cargo chef prepare --recipe-path /app/recipe.json

FROM chef AS build

COPY --from=planner /app/recipe.json /app/recipe.json
COPY v2/core-c /app/v2/core-c
COPY v2/ai-model-rust /app/v2/ai-model-rust

# Keep third-party Rust dependencies in a layer that application source edits do
# not invalidate. The release workflow persists this layer in ECR.
RUN cargo chef cook --release --recipe-path /app/recipe.json

COPY v2/core-c /app/v2/core-c
COPY v2/content /app/v2/content
COPY v2/content-engine-version.txt /app/v2/content-engine-version.txt
COPY v2/media /app/v2/media
COPY v2/ai-model-rust /app/v2/ai-model-rust
COPY v2/orchestrator-rust /app/v2/orchestrator-rust

# Keep release incremental data outside the image layer so the remote builder
# can reuse unchanged code after the application source COPY invalidates this
# step. Serial Cargo jobs still cap memory after prior parallel builds were
# killed by the builder's OOM guard.
RUN --mount=type=cache,id=cosyworld-release-incremental,target=/app/v2/orchestrator-rust/target/release/incremental,sharing=locked \
  CARGO_INCREMENTAL=1 CARGO_BUILD_JOBS=1 cargo build --release

FROM debian:bookworm-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive
ENV COSYWORLD_V2_ADDR=0.0.0.0:3000
ENV COSYWORLD_V2_SNAPSHOT_PATH=/data/cosyworld-v2-snapshot.json
ENV COSYWORLD_V2_EVENT_DB_PATH=/data/cosyworld-v2-events.sqlite
ENV COSYWORLD_CONTENT_ROOT=/app/v2/content
ENV RUST_LOG=cosyworld_orchestrator=info,tower_http=warn

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gosu nginx \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system cosyworld \
  && useradd --system --no-create-home --gid cosyworld --groups www-data --shell /usr/sbin/nologin cosyworld \
  && mkdir -p /data \
  && chown cosyworld:cosyworld /data \
  && chmod 0770 /data

COPY --from=build /app/v2/orchestrator-rust/target/release/cosyworld-orchestrator /app/cosyworld-orchestrator
COPY --from=build /app/v2/content /app/v2/content
COPY models/card-policy /app/models/card-policy
COPY deploy/lonelyforest /app/deploy/lonelyforest
COPY deploy/entrypoint.sh /app/entrypoint.sh

RUN chmod 0755 \
  /app/entrypoint.sh \
  /app/deploy/lonelyforest/check-required-health.sh \
  /app/deploy/lonelyforest/run-multitenant.sh

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["/app/cosyworld-orchestrator"]
