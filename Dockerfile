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
COPY v2/ai-model-rust /app/v2/ai-model-rust
COPY v2/orchestrator-rust /app/v2/orchestrator-rust
COPY src/services/web/public/images/cosy-cottage.png /app/src/services/web/public/images/cosy-cottage.png

RUN cargo build --release

FROM debian:bookworm-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive
ENV COSYWORLD_V2_ADDR=0.0.0.0:3000
ENV COSYWORLD_V2_SNAPSHOT_PATH=/data/cosyworld-v2-snapshot.json
ENV COSYWORLD_V2_EVENT_DB_PATH=/data/cosyworld-v2-events.sqlite
ENV COSYWORLD_CONTENT_ROOT=/app/v2/content
ENV RUST_LOG=cosyworld_orchestrator=info,tower_http=warn

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data

COPY --from=build /app/v2/orchestrator-rust/target/release/cosyworld-orchestrator /app/cosyworld-orchestrator
COPY --from=build /app/v2/content /app/v2/content

EXPOSE 3000

CMD ["/app/cosyworld-orchestrator"]
