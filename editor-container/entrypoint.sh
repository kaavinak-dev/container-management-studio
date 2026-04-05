#!/bin/bash
set -euo pipefail

: "${MINIO_ENDPOINT:?MINIO_ENDPOINT is required}"
: "${MINIO_PORT:?MINIO_PORT is required}"
: "${MINIO_ACCESS_KEY:?MINIO_ACCESS_KEY is required}"
: "${MINIO_SECRET_KEY:?MINIO_SECRET_KEY is required}"
: "${MINIO_BUCKET:?MINIO_BUCKET is required}"
: "${PROJECT_ID:?PROJECT_ID is required}"

WORKSPACE=/workspace
MINIO_URL="http://${MINIO_ENDPOINT}:${MINIO_PORT}"

echo "[entrypoint] Mounting MinIO bucket ${MINIO_BUCKET}/${PROJECT_ID} -> ${WORKSPACE}"

# Unmount on exit
cleanup() {
  echo "[entrypoint] Unmounting ${WORKSPACE}"
  umount "${WORKSPACE}/node_modules" 2>/dev/null || true
  fusermount3 -u "${WORKSPACE}" 2>/dev/null || true
}
trap cleanup EXIT SIGTERM SIGINT

# Mount rclone in daemon mode
# --allow-non-empty: /workspace/node_modules is already bind-mounted by Docker; FUSE overlays it
# --vfs-cache-mode full: required for rename() correctness and npm install performance
# --exclude node_modules/**: never route node_modules through FUSE (served by Docker volume)
rclone mount \
  ":s3:${MINIO_BUCKET}/${PROJECT_ID}" \
  "${WORKSPACE}" \
  --s3-provider Minio \
  --s3-env-auth=false \
  --s3-access-key-id="${MINIO_ACCESS_KEY}" \
  --s3-secret-access-key="${MINIO_SECRET_KEY}" \
  --s3-endpoint="${MINIO_URL}" \
  --s3-force-path-style \
  --allow-other \
  --allow-non-empty \
  --vfs-cache-mode full \
  --vfs-cache-max-size 500M \
  --vfs-write-back 5s \
  --exclude "node_modules/**" \
  --daemon \
  --log-file /var/log/rclone.log

echo "[entrypoint] rclone daemon launched, waiting for mount..."

# Poll /proc/mounts until fuse.rclone entry appears for /workspace
MOUNT_TIMEOUT=30
ELAPSED=0
until grep -q " ${WORKSPACE} fuse.rclone " /proc/mounts 2>/dev/null; do
  if [ "${ELAPSED}" -ge "${MOUNT_TIMEOUT}" ]; then
    echo "[entrypoint] ERROR: FUSE mount not confirmed after ${MOUNT_TIMEOUT}s"
    cat /var/log/rclone.log || true
    exit 1
  fi
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done

echo "[entrypoint] FUSE mount confirmed (${ELAPSED}s). Overlaying node_modules with local volume..."

# node_modules must NOT go through FUSE (rclone --exclude causes EIO on symlink creation).
# Bind-mount a local tmpfs over /workspace/node_modules so npm install works on a real fs.
mkdir -p /var/nm_overlay
mkdir -p "${WORKSPACE}/node_modules"
mount --bind /var/nm_overlay "${WORKSPACE}/node_modules"

echo "[entrypoint] node_modules overlay ready. Starting sidecar..."

# Run sidecar as child (not exec) so EXIT trap fires on container stop
node --inspect=0.0.0.0:9229 /app/editor-sidecar.js &
SIDECAR_PID=$!
wait "${SIDECAR_PID}"
