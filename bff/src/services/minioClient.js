const Minio = require('minio');

// ─── Dev server list ──────────────────────────────────────────────────────────
// Mirrors the hardcoded list in container-management/ContainerManagerBackend/Program.cs.
// Prod: throw (same pattern as C# FetchCurrentRunningStorageEngines NotImplementedException).
const IS_DEV = process.env.NODE_ENV !== 'production';

const DEV_SERVERS = [
  { host: '127.0.0.1', port: 9002,
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin' },
  { host: '127.0.0.1', port: 9003,
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin' },
];

function discoverServers() {
  if (IS_DEV) return DEV_SERVERS;
  throw new Error('Production MinIO discovery is not implemented.');
}

// ─── Client pool ──────────────────────────────────────────────────────────────
// One Minio.Client per server, keyed by "host:port". No election here — the C# backend
// decides which server to use and stores it in ProjectRecord.StorageUrl.
const servers = discoverServers();
const clients = new Map(); // "host:port" → Minio.Client
const fallbackKey = `${servers[0].host}:${servers[0].port}`;

for (const srv of servers) {
  clients.set(`${srv.host}:${srv.port}`, new Minio.Client({
    endPoint: srv.host, port: srv.port, useSSL: false,
    accessKey: srv.accessKey, secretKey: srv.secretKey,
  }));
}

// ─── Project → server affinity map ───────────────────────────────────────────
// projectId (string) → serverKey ("host:port")
// Populated on BFF startup (initProjectMappings) and on each project creation (registerProject).
const projectServerMap = new Map();

function normalizeUrl(storageUrl) {
  // "http://192.168.99.101:9002" → "192.168.99.101:9002"
  return storageUrl.replace(/^https?:\/\//, '');
}

function clientForProject(projectId) {
  const key = projectServerMap.get(String(projectId)) ?? fallbackKey;
  return clients.get(key) ?? clients.get(fallbackKey);
}

// Called by POST /projects after backend.createProject() returns storageUrl
function registerProject(projectId, storageUrl) {
  projectServerMap.set(String(projectId), normalizeUrl(storageUrl));
}

// Called on BFF startup — bulk loads the map from the backend project list
function initProjectMappings(projects) {
  for (const p of projects) {
    if (p.projectId && p.storageUrl) {
      projectServerMap.set(String(p.projectId), normalizeUrl(p.storageUrl));
    }
  }
}

// ─── Bucket + file operations ─────────────────────────────────────────────────
const BUCKET = process.env.EDITOR_BUCKET || 'editor-projects';

async function ensureBucket() {
  for (const [, client] of clients) {
    const exists = await client.bucketExists(BUCKET);
    if (!exists) await client.makeBucket(BUCKET);
  }
}

async function putFile(projectId, filePath, content) {
  await clientForProject(projectId).putObject(BUCKET, `${projectId}/${filePath}`, Buffer.from(content, 'utf8'));
}

async function getFile(projectId, filePath) {
  const stream = await clientForProject(projectId).getObject(BUCKET, `${projectId}/${filePath}`);
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', c => chunks.push(c));
    stream.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

async function listFiles(projectId) {
  return new Promise((resolve, reject) => {
    const files = [];
    const prefix = `${projectId}/`;
    const stream = clientForProject(projectId).listObjects(BUCKET, prefix, true);
    stream.on('data', obj => { const rel = obj.name.slice(prefix.length); if (rel) files.push(rel); });
    stream.on('end',  () => resolve(files));
    stream.on('error', reject);
  });
}

async function deleteFile(projectId, filePath) {
  await clientForProject(projectId).removeObject(BUCKET, `${projectId}/${filePath}`);
}

async function deleteProject(projectId) {
  const client = clientForProject(projectId);
  const prefix = `${projectId}/`;
  const keys = await new Promise((resolve, reject) => {
    const list = [];
    const stream = client.listObjects(BUCKET, prefix, true);
    stream.on('data', obj => list.push(obj.name));
    stream.on('end',  () => resolve(list));
    stream.on('error', reject);
  });
  if (keys.length) await client.removeObjects(BUCKET, keys);
  projectServerMap.delete(String(projectId));
}

function getFileStream(projectId, filePath) {
  return clientForProject(projectId).getObject(BUCKET, `${projectId}/${filePath}`);
}

module.exports = {
  ensureBucket,
  registerProject,
  initProjectMappings,
  putFile, getFile, listFiles,
  deleteFile, deleteProject, getFileStream,
};
