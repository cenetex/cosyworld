#!/bin/sh
set -eu

# Fly mounts /data after the image is built, so the image-layer ownership is
# not enough. Fix the mounted volume while still privileged, then run every
# application process without root privileges.
if [ "$(id -u)" -eq 0 ]; then
  chown -R cosyworld:cosyworld /data
  exec gosu cosyworld "$@"
fi

exec "$@"
