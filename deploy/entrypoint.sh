#!/bin/sh
set -eu

if [ "$(id -u)" -eq 0 ]; then
  chown -R cosyworld:cosyworld /data
  mkdir -p /tmp/cosyworld-nginx
  chown -R cosyworld:cosyworld /tmp/cosyworld-nginx
  exec gosu cosyworld "$@"
fi

exec "$@"
