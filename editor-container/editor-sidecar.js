'use strict';

const Minio = require('minio');
const http = require('http');
const { spawn, execFile } = require('child_process');
const fs = require('fs/promises');
const { createWriteStream } = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const {
  MINIO_ENDPOINT,
  MINIO_PORT,
  MINIO_ACCESS_KEY,
  MINIO_SECRET_KEY,
  MINIO_BUCKET,
  PROJECT_ID,
} = process.env;

const WORKSPACE = '/workspace';

const minioClient = new Minio.Client({
  endPoint: MINIO_ENDPOINT,
  port: parseInt(MINIO_PORT, 10),
  useSSL: false,
  accessKey: MINIO_ACCESS_KEY,
  secretKey: MINIO_SECRET_KEY,
});

// ---------------------------------------------------------------------------
// MinIO helpers
// ---------------------------------------------------------------------------

function listMinioObjects(prefix) {
  return new Promise((resolve, reject) => {
    const objects = [];
    const stream = minioClient.listObjects(MINIO_BUCKET, prefix, true);
    stream.on('data', (obj) => objects.push(obj));
    stream.on('end', () => resolve(objects));
    stream.on('error', reject);
  });
}

function downloadObject(minioKey, localPath) {
  return new Promise((resolve, reject) => {
    minioClient.getObject(MINIO_BUCKET, minioKey, (err, dataStream) => {
      if (err) return reject(err);
      const writer = createWriteStream(localPath);
      dataStream.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
      dataStream.on('error', reject);
    });
  });
}

// ---------------------------------------------------------------------------
// Local filesystem helpers
// ---------------------------------------------------------------------------

async function listLocalFiles(dir, base) {
  base = base || dir;
  const results = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(base, fullPath);
    // Skip node_modules at any nesting level
    if (entry.name === 'node_modules') continue;
    if (entry.isDirectory()) {
      const nested = await listLocalFiles(fullPath, base);
      results.push(...nested);
    } else {
      results.push(relPath);
    }
  }
  return results;
}

async function md5File(filePath) {
  const buf = await fs.readFile(filePath);
  return crypto.createHash('md5').update(buf).digest('hex');
}

// ---------------------------------------------------------------------------
// Step 1 — Sync files from MinIO
// ---------------------------------------------------------------------------

async function syncFiles() {
  const prefix = `${PROJECT_ID}/`;
  console.log(`[sync] Listing MinIO objects under prefix "${prefix}"...`);

  const minioObjects = await listMinioObjects(prefix);
  console.log(`[sync] Found ${minioObjects.length} object(s) in MinIO`);

  const localFiles = await listLocalFiles(WORKSPACE);
  const isColdStart = localFiles.length === 0;
  console.log(`[sync] ${isColdStart ? 'Cold start' : 'Warm start'} — ${localFiles.length} local file(s)`);

  if (isColdStart) {
    // Fetch every file from MinIO
    for (const obj of minioObjects) {
      const relPath = obj.name.slice(prefix.length);
      if (!relPath) continue; // skip the prefix key itself if listed
      const localPath = path.join(WORKSPACE, relPath);
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      console.log(`[sync] Fetching ${relPath}`);
      await downloadObject(obj.name, localPath);
    }
  } else {
    // Warm start: diff by ETag (MD5 for single-part uploads)
    const minioMap = new Map();
    for (const obj of minioObjects) {
      const relPath = obj.name.slice(prefix.length);
      if (!relPath) continue;
      minioMap.set(relPath, obj);
    }

    const localSet = new Set(localFiles);

    // Fetch or overwrite files that differ
    for (const [relPath, obj] of minioMap) {
      const localPath = path.join(WORKSPACE, relPath);
      const etag = obj.etag.replace(/"/g, '');
      let needsFetch = true;

      if (localSet.has(relPath)) {
        const localMd5 = await md5File(localPath);
        needsFetch = localMd5 !== etag;
      }

      if (needsFetch) {
        console.log(`[sync] Updating ${relPath}`);
        await fs.mkdir(path.dirname(localPath), { recursive: true });
        await downloadObject(obj.name, localPath);
      } else {
        console.log(`[sync] Skipping ${relPath} (unchanged)`);
      }
    }

    // Delete local files that no longer exist in MinIO
    for (const relPath of localSet) {
      if (!minioMap.has(relPath)) {
        console.log(`[sync] Deleting ${relPath} (removed from MinIO)`);
        await fs.unlink(path.join(WORKSPACE, relPath)).catch(() => {});
      }
    }
  }

  console.log('[sync] Done');
}

// ---------------------------------------------------------------------------
// Step 2 — npm install (guarded by package-lock.json hash)
// ---------------------------------------------------------------------------

async function checkAndInstall() {
  const lockFilePath = path.join(WORKSPACE, 'package-lock.json');
  let lockContent;
  try {
    lockContent = await fs.readFile(lockFilePath);
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.log('[npm] No package-lock.json found — skipping npm install');
      return;
    }
    throw e;
  }

  const hash = crypto.createHash('sha256').update(lockContent).digest('hex');
  const hashFilePath = path.join(WORKSPACE, 'node_modules', '.install-hash');

  let existingHash = null;
  try {
    existingHash = (await fs.readFile(hashFilePath, 'utf8')).trim();
  } catch {
    // hash file doesn't exist yet — that's fine
  }

  if (existingHash === hash) {
    console.log('[npm] node_modules up to date — skipping npm install');
    return;
  }

  console.log('[npm] Running npm install...');
  await new Promise((resolve, reject) => {
    const proc = spawn('npm', ['install', '--prefix', WORKSPACE], {
      stdio: 'inherit',
    });
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm install exited with code ${code}`));
    });
    proc.on('error', reject);
  });

  await fs.writeFile(hashFilePath, hash);
  console.log('[npm] Install complete');
}

// ---------------------------------------------------------------------------
// Step 3 — HTTP server on port 5003
// ---------------------------------------------------------------------------

function startHttpServer() {
  const server = http.createServer((req, res) => {
    const urlPath = req.url || '/';

    // GET /health
    if (req.method === 'GET' && urlPath === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ready' }));
      return;
    }

    // PUT /files/:filepath  and  DELETE /files/:filepath
    if (urlPath.startsWith('/files/')) {
      const relPath = urlPath.slice('/files/'.length);

      if (!relPath) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'missing file path' }));
        return;
      }

      // Path traversal guard
      const resolvedPath = path.resolve(WORKSPACE, relPath);
      if (!resolvedPath.startsWith(WORKSPACE + path.sep) && resolvedPath !== WORKSPACE) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'invalid path' }));
        return;
      }

      if (req.method === 'PUT') {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', async () => {
          try {
            const body = Buffer.concat(chunks);
            await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
            await fs.writeFile(resolvedPath, body);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            console.error('[http] PUT error:', e);
            res.writeHead(500);
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        req.on('error', (e) => {
          console.error('[http] Request error:', e);
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message }));
        });
        return;
      }

      if (req.method === 'DELETE') {
        fs.unlink(resolvedPath)
          .catch(() => {}) // idempotent — ignore ENOENT
          .then(() => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          });
        return;
      }
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(5003, () => console.log('[http] Listening on port 5003'));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`[sidecar] Starting for project "${PROJECT_ID}"`);

  await syncFiles();
  await checkAndInstall();

  startHttpServer(); // port 5003

  console.log('[sidecar] All services started');
}

main().catch((e) => {
  console.error('[sidecar] Fatal error:', e);
  process.exit(1);
});
