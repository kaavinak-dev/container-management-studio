const { Router } = require('express');
const minio = require('../services/minioClient');
const backend = require('../services/backendClient');
const archiver = require('archiver');
const FormData = require('form-data');

const router = Router();

// Reject paths that try to escape the project dir
function isValidPath(p) {
  if (!p) return false;
  if (p.includes('..'))  return false;
  if (p.startsWith('/')) return false;
  return true;
}

// POST /projects
// Body: { name: string }
// 1. Creates ProjectRecord in backend DB (gets projectId back)
// 2. BFF uploads template files to MinIO using that same projectId
// Returns: { projectId, name, files: string[] }
router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const project = await backend.createProject(name);
  const { projectId, storageUrl } = project;

  minio.registerProject(projectId, storageUrl);

  const { files: templateFiles } = require('../templates/nodejs');
  const { initProjectFromTemplate } = require('../services/projectInitService');
  await initProjectFromTemplate(projectId, templateFiles);

  const allFiles = [...Object.keys(templateFiles), 'package-lock.json'];
  return res.status(201).json({ projectId, name, files: allFiles });
});

// GET /projects
// Returns: [{ projectId, projectName, projectType, status, createdAt }]
router.get('/', async (req, res) => {
  const projects = await backend.listProjects();
  return res.json(projects);
});

// GET /projects/:id
router.get('/:id', async (req, res) => {
  try {
    const project = await backend.getProject(req.params.id);
    return res.json(project);
  } catch {
    return res.status(404).json({ error: 'Project not found' });
  }
});

// DELETE /projects/:id
// Backend deletes DB record; BFF then cleans up MinIO files
router.delete('/:id', async (req, res) => {
  try {
    await backend.deleteProject(req.params.id); // throws 404 if not found
    await minio.deleteProject(req.params.id);
    return res.status(204).send();
  } catch (err) {
    if (err.response?.status === 404) return res.status(404).json({ error: 'Project not found' });
    throw err;
  }
});

// GET /projects/:id/files
router.get('/:id/files', async (req, res) => {
  try {
    const files = await minio.listFiles(req.params.id);
    return res.json({ files });
  } catch {
    return res.status(404).json({ error: 'Project not found' });
  }
});

// GET /projects/:id/files/*path
router.get('/:id/files/*', async (req, res) => {
  const filePath = req.params[0];
  if (!isValidPath(filePath)) return res.status(400).json({ error: 'Invalid path' });
  try {
    const content = await minio.getFile(req.params.id, filePath);
    return res.json({ content });
  } catch {
    return res.status(404).json({ error: 'File not found' });
  }
});

// PUT /projects/:id/files/*path
// Body: { content: string }
router.put('/:id/files/*', async (req, res) => {
  const filePath = req.params[0];
  if (!isValidPath(filePath)) return res.status(400).json({ error: 'Invalid path' });
  const { content } = req.body;
  if (content === undefined) return res.status(400).json({ error: 'content is required' });
  try {
    await minio.putFile(req.params.id, filePath, content);

    return res.status(204).send();
  } catch {
    console.log("error data");
    return res.status(404).json({ error: 'Project not found' });
  }
});

// DELETE /projects/:id/files/*path
router.delete('/:id/files/*', async (req, res) => {
  const filePath = req.params[0];
  if (!isValidPath(filePath)) return res.status(400).json({ error: 'Invalid path' });
  try {
    await minio.deleteFile(req.params.id, filePath);

    return res.status(204).send();
  } catch {
    return res.status(404).json({ error: 'File not found' });
  }
});

// POST /projects/:id/deploy
// Buffer the archive into memory before forming the multipart request
// Ensures FormData can properly serialize boundaries for the .NET backend
router.post('/:id/deploy', async (req, res) => {
  const { id } = req.params;
  const files = await minio.listFiles(id);
  console.log("files ", files)
  if (!files.length) return res.status(400).json({ error: 'Project has no files' });

  const archive = archiver('zip');
  archive.on('error', err => { throw err; });

  for (const filePath of files) {
    const fileStream = await minio.getFileStream(id, filePath);
    archive.append(fileStream, { name: filePath });
  }

  // Collect archive chunks into a buffer
  const chunks = [];
  archive.on('data', chunk => chunks.push(chunk));

  return new Promise((resolve, reject) => {
    archive.on('end', async () => {
      try {
        const zipBuffer = Buffer.concat(chunks);
        const form = new FormData();
        form.append('files', zipBuffer, {
          filename: `${id}.zip`,
          contentType: 'application/zip'
        });

        console.log("form send")
        const result = await backend.deployProjectForm(id, form);
        console.log("result ", result)
        res.status(202).json(result);
        resolve();
      } catch (err) {
        console.log("error data");
        reject(err);
      }
    });

    archive.finalize();
  });
});

module.exports = { router };
