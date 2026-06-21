#!/bin/sh
set -eu

export DATA_BACKEND="${DATA_BACKEND:-sqlite}"
export SQLITE_DB_PATH="${SQLITE_DB_PATH:-/data/cosyworld.sqlite}"
export FILE_STORAGE_BACKEND="${FILE_STORAGE_BACKEND:-local}"
export LOCAL_MEDIA_DIR="${LOCAL_MEDIA_DIR:-/data/media}"

mkdir -p "$(dirname "$SQLITE_DB_PATH")" "$LOCAL_MEDIA_DIR"

exec node src/index.mjs
