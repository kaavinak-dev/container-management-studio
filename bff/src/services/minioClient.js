const Minio = require('minio');

const client = new Minio.Client({
  endPoint:  process.env.MINIO_ENDPOINT  || 'localhost',
  port:      Number(process.env.MINIO_PORT) || 9000,
  useSSL:    false,
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
});

const BUCKET = process.env.EDITOR_BUCKET || 'editor-projects';

async function ensureBucket() {
  const exists = await client.bucketExists(BUCKET);
  if (!exists) await client.makeBucket(BUCKET);
}

async function putFile(projectId, filePath, content) {
  const key = `${projectId}/${filePath}`;
  await client.putObject(BUCKET, key, Buffer.from(content, 'utf8'));
}

async function getFile(projectId, filePath) {
  const key = `${projectId}/${filePath}`;
  const stream = await client.getObject(BUCKET, key);
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
    const stream = client.listObjects(BUCKET, prefix, true);
    stream.on('data', obj => {
      const rel = obj.name.slice(prefix.length);
      if (rel) files.push(rel);
    });
    stream.on('end',  () => resolve(files));
    stream.on('error', reject);
  });
}

async function deleteFile(projectId, filePath) {
  await client.removeObject(BUCKET, `${projectId}/${filePath}`);
}

async function deleteProject(projectId) {
  const prefix = `${projectId}/`;
  const keys = await new Promise((resolve, reject) => {
    const list = [];
    const stream = client.listObjects(BUCKET, prefix, true);
    stream.on('data', obj => list.push(obj.name));
    stream.on('end',  () => resolve(list));
    stream.on('error', reject);
  });
  if (keys.length) await client.removeObjects(BUCKET, keys);
}

// Returns raw stream — used by deploy route to pipe directly into archiver
function getFileStream(projectId, filePath) {
  return client.getObject(BUCKET, `${projectId}/${filePath}`);
}

module.exports = {
  ensureBucket,
  putFile, getFile, listFiles,
  deleteFile, deleteProject,
  getFileStream,
};
