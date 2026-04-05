# Plan: MinIO FUSE Mount for Editor Container (Bi-directional File Sync)

## Context

The editor container currently has asymmetric file sync: MinIO → container on startup (via `syncFiles()` in `editor-sidecar.js`), and BFF → MinIO + container via dual-write on UI saves. There is **no reverse path**: terminal changes (e.g., `npm install` updating `package.json`) are lost when the container stops.

The fix is to replace the Docker named volume for `/workspace` with a **rclone FUSE mount** of the MinIO bucket prefix directly to `/workspace`. MinIO becomes the live filesystem — writes from any source (terminal, editor UI) are immediately persistent. The `node_modules` Docker named volume stays as-is (fast, local, not in MinIO).

---

## Mount Sequence (Critical)

Docker binds `npm-cache-{projectId}-{hash}` to `/workspace/node_modules` **before PID 1 runs**. When `entrypoint.sh` then mounts rclone at `/workspace`, the kernel mount table keeps `/workspace/node_modules` as an independent, deeper entry — it is **not displaced** by the FUSE mount. rclone's `--allow-non-empty` flag allows mounting over a non-empty directory. The `--exclude node_modules/**` flag prevents rclone from touching that subtree. Result: FUSE serves all of `/workspace` except `/workspace/node_modules`, which is served by the fast Docker volume.

---

## Files to Change

### 1. `container-management-studio/editor-container/Dockerfile`

Install `fuse3` + `rclone`. Change CMD to `/entrypoint.sh`.

**Replace the entire file:**
```dockerfile
FROM node:20-slim

# Build tools required by node-pty native addon (node-gyp)
RUN apt-get update && apt-get install -y \
      python3 make g++ \
      fuse3 \
      ca-certificates \
      curl \
    && rm -rf /var/lib/apt/lists/*

# Install rclone (single binary, S3-compatible, supports VFS caching)
RUN curl https://rclone.org/install.sh | bash

# Allow FUSE mounts to be readable by other processes in the container
RUN sed -i 's/#user_allow_other/user_allow_other/' /etc/fuse.conf

# Install typescript-language-server and typescript globally so the binary is on PATH
RUN npm install -g typescript typescript-language-server

# Set up sidecar app directory with its runtime dependencies
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev

COPY editor-sidecar.js .

# Entrypoint: mounts FUSE then starts sidecar
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create the workspace mount point
RUN mkdir -p /workspace

EXPOSE 5002 5003 9999 9229

CMD ["/entrypoint.sh"]
```

---

### 2. `container-management-studio/editor-container/entrypoint.sh` (NEW FILE)

```bash
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

echo "[entrypoint] Mounting MinIO bucket ${MINIO_BUCKET}/${PROJECT_ID} → ${WORKSPACE}"

# Unmount on exit
cleanup() {
  echo "[entrypoint] Unmounting ${WORKSPACE}"
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

echo "[entrypoint] FUSE mount confirmed (${ELAPSED}s). Starting sidecar..."

# Run sidecar as child (not exec) so EXIT trap fires on container stop
node --inspect=0.0.0.0:9229 /app/editor-sidecar.js &
SIDECAR_PID=$!
wait "${SIDECAR_PID}"
```

---

### 3. `container-management-studio/editor-container/editor-sidecar.js`

**Remove** (lines 1–162 to be trimmed):
- `const Minio = require('minio');` (line 3)
- `const { createWriteStream } = require('fs');` (line 9) — no longer needed
- All MINIO_* env var destructuring (lines 17–24); keep `PROJECT_ID` and `WORKSPACE`
- `const minioClient = new Minio.Client({...})` block (lines 28–34)
- `listMinioObjects()` function (lines 40–48)
- `downloadObject()` function (lines 50–61)
- `listLocalFiles()` function (lines 67–89)
- `md5File()` function (lines 91–94)
- `syncFiles()` function (lines 100–162) — the entire Step 1 block

**Add** `waitForFuseMount()` after the remaining config block:
```javascript
async function waitForFuseMount() {
  const TIMEOUT_MS = 15_000;
  const start = Date.now();
  while (true) {
    try {
      await fs.readdir(WORKSPACE);
      console.log('[fuse] /workspace is accessible');
      return;
    } catch (e) {
      if (Date.now() - start > TIMEOUT_MS)
        throw new Error(`[fuse] /workspace not accessible after ${TIMEOUT_MS}ms: ${e.message}`);
      await new Promise(r => setTimeout(r, 500));
    }
  }
}
```

**Fix health response** (line 223) — this is also a pre-existing bug fix. The C# poller checks for `lspRunning: true` but the sidecar returns `{ status: 'ready' }`:
```javascript
// Change FROM:
res.end(JSON.stringify({ status: 'ready' }));
// Change TO:
res.end(JSON.stringify({ lspRunning: true }));
```

**Update `main()`** (lines 346–356):
```javascript
async function main() {
  console.log(`[sidecar] Starting for project "${PROJECT_ID}"`);

  await waitForFuseMount();   // replaces syncFiles()
  await checkAndInstall();

  startHttpServer(); // port 5003
  startPtyServer();  // port 9999

  console.log('[sidecar] All services started');
}
```

`checkAndInstall()`, `startHttpServer()`, and `startPtyServer()` are **unchanged**.

---

### 4. `container-management/Engines/FileStorageEngines/EditorContainerService.cs`

**In `StartEditorContainerAsync`** (lines 155–234):

Remove `workspaceVolume` variable (line 158) — it no longer exists.

In `HostConfig` (lines 184–198), replace:
```csharp
HostConfig = new HostConfig
{
    Binds = new List<string>
    {
        $"{workspaceVolume}:/workspace",
        $"{npmCacheVolume}:/workspace/node_modules",
    },
    PortBindings = new Dictionary<string, IList<PortBinding>> { ... },
},
```
With:
```csharp
HostConfig = new HostConfig
{
    Binds = new List<string>
    {
        $"{npmCacheVolume}:/workspace/node_modules",  // workspace-* volume removed; FUSE serves /workspace
    },
    Devices = new List<DeviceMapping>
    {
        new DeviceMapping
        {
            PathOnHost      = "/dev/fuse",
            PathInContainer = "/dev/fuse",
            CgroupPermissions = "rwm",
        }
    },
    CapAdd    = new List<string> { "SYS_ADMIN" },
    SecurityOpt = new List<string> { "apparmor:unconfined" }, // required on Ubuntu/WSL2 for FUSE mount syscalls
    PortBindings = new Dictionary<string, IList<PortBinding>>
    {
        { "5002/tcp", new List<PortBinding> { new() { HostIP = "127.0.0.1", HostPort = "5002" } } },
        { "5003/tcp", new List<PortBinding> { new() { HostIP = "127.0.0.1", HostPort = "5003" } } },
        { "9999/tcp", new List<PortBinding> { new() { HostIP = "127.0.0.1", HostPort = "9999" } } },
        { "9229/tcp", new List<PortBinding> { new() { HostIP = "127.0.0.1", HostPort = "9229" } } },
    },
},
```

**In the `EditorSessionRecord` add block** (line 213–223), change `WorkspaceVolume`:
```csharp
_db.EditorSessions.Add(new EditorSessionRecord
{
    ProjectId      = projectId,
    ContainerName  = containerName,
    WorkspaceVolume = "fuse-managed",    // no Docker volume; rclone FUSE serves /workspace
    NpmCacheVolume  = npmCacheVolume,
    ContainerIp    = containerIp,
    Status         = "Starting",
    LastActive     = DateTime.UtcNow,
    CreatedAt      = DateTime.UtcNow,
});
```

**In `DeleteVolumesAsync`** (lines 337–342), remove the workspace volume deletion since it no longer exists:
```csharp
public async Task DeleteVolumesAsync(string workspaceVolume, string npmCacheVolume)
{
    var client = GetDockerClient();
    // workspaceVolume is "fuse-managed" sentinel — no Docker volume to delete
    try { await client.Volumes.RemoveAsync(npmCacheVolume); } catch { }
}
```

---

### 5. `container-management-studio/bff/src/routes/projects.js`

**In `PUT /projects/:id/files/*`** (lines 104–113), remove the dual-write block:
```javascript
// DELETE these lines:
const session = editorSessionManager.sessions.get(req.params.id);
if (session) {
  axios.put(
    `http://${session.containerIp}:${session.fileApiPort}/files/${filePath}`,
    content,
    { headers: { 'Content-Type': 'text/plain' } }
  ).catch((err) => console.error('[dual-write] PUT to container failed (non-fatal):', err.message));
}
```

**In `DELETE /projects/:id/files/*`** (lines 129–134), remove the dual-write block:
```javascript
// DELETE these lines:
const session = editorSessionManager.sessions.get(req.params.id);
if (session) {
  axios.delete(`http://${session.containerIp}:${session.fileApiPort}/files/${filePath}`)
    .catch((err) => console.error('[dual-write] DELETE to container failed (non-fatal):', err.message));
}
```

After removing the dual-writes, `editorSessionManager` and `axios` are no longer referenced in `projects.js`. Remove their imports at the top of the file.

---

## Verification Steps

**Step 1 — Build the image:**
```bash
docker build -t editor-base:latest ./container-management-studio/editor-container/
```

**Step 2 — Smoke test FUSE mount manually:**
```bash
docker run --rm -it \
  --device /dev/fuse \
  --cap-add SYS_ADMIN \
  --security-opt apparmor:unconfined \
  -e MINIO_ENDPOINT=host.docker.internal \
  -e MINIO_PORT=9002 \
  -e MINIO_ACCESS_KEY=minioadmin \
  -e MINIO_SECRET_KEY=minioadmin \
  -e MINIO_BUCKET=editor-projects \
  -e PROJECT_ID=test-project-001 \
  editor-base:latest bash
# Inside container:
# cat /proc/mounts | grep workspace  → should show fuse.rclone entry
# ls /workspace                      → should show project files from MinIO
# echo "hello" >> /workspace/test.txt && sleep 6
# Then verify test.txt exists in MinIO via mc or MinIO console
```

**Step 3 — Verify node_modules overlay:**
```bash
docker volume create npm-cache-test
docker run --rm -it \
  --device /dev/fuse --cap-add SYS_ADMIN --security-opt apparmor:unconfined \
  -v npm-cache-test:/workspace/node_modules \
  -e MINIO_ENDPOINT=host.docker.internal ... \
  editor-base:latest bash
# cat /proc/mounts | grep workspace
# → two entries: fuse.rclone at /workspace AND Docker volume at /workspace/node_modules
```

**Step 4 — End-to-end via UI:**
1. Start the .NET backend + BFF + infrastructure
2. Open a project in the editor
3. In the PTY terminal: `echo "test" >> /workspace/README.md`
4. Stop the container session
5. Restart the session
6. Verify `README.md` contains "test" — confirms terminal changes persisted through FUSE

**Step 5 — Verify health check fixed:**
Confirm the BFF's session startup completes (previously broken because `/health` returned `{status:'ready'}` but the C# poller expected `{lspRunning:true}`). Session should reach `Ready` state within the normal startup window.

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| MinIO unreachable at mount time | rclone mount fails → entrypoint exits → container restart |
| MinIO becomes unreachable after mount | Cached reads still work; writes queue in VFS cache; rclone retries flush every 5s |
| Container crashes mid-write | VFS cache (local) is lost; MinIO has last-flushed state (≤5s old) |
| `npm install` writes `package.json` | Writes go through FUSE VFS cache → flushed to MinIO within 5s |
| BFF writes a file via UI save | Writes to MinIO; rclone VFS cache invalidates on next read; container sees update |
| node_modules not excluded from FUSE | `--exclude node_modules/**` prevents rclone from listing or uploading node_modules |
