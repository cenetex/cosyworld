FROM timberio/vector:0.55.0-debian@sha256:a4be1111b40303524aae2ffb02cd59cef2a4e9753bd13d265bf0233e921828d9

COPY deploy/observability/vector.yaml /etc/vector/vector.yaml

ENTRYPOINT ["/usr/bin/vector"]
CMD ["--config", "/etc/vector/vector.yaml"]
