FROM rust:1-bookworm AS build

WORKDIR /app

COPY v2/core-c ./v2/core-c
COPY v2/orchestrator-rust ./v2/orchestrator-rust
COPY src/services/web/public/images/cosy-cottage.png ./src/services/web/public/images/cosy-cottage.png

WORKDIR /app/v2/orchestrator-rust
RUN cargo build --release

FROM debian:bookworm-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive
ENV COSYWORLD_V2_ADDR=0.0.0.0:3000
ENV COSYWORLD_V2_SNAPSHOT_PATH=/data/cosyworld-v2-snapshot.json
ENV COSYWORLD_V2_EVENT_DB_PATH=/data/cosyworld-v2-events.sqlite
ENV RUST_LOG=cosyworld_orchestrator=info,tower_http=warn

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data

COPY --from=build /app/v2/orchestrator-rust/target/release/cosyworld-orchestrator /app/cosyworld-orchestrator

EXPOSE 3000

CMD ["/app/cosyworld-orchestrator"]
