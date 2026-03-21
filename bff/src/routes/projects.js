const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const minio = require('../services/minioClient');

const router = Router();

// Reject paths that try to escape the project dir or touch internal metadata
function isValidPath(p) {
  if (!p) return false;
  if (p.includes('..'))      return false;
  if (p.startsWith('/'))     return false;
  if (p === '.meta.json')    return false;
  if (p.startsWith('.meta')) return false;
  return true;
}

// POST /projects
// Body: { name: string }
// Returns: { projectId, name, files: string[] }
router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const projectId = uuidv4();
  const { files: templateFiles } = require('../templates/nodejs');

  await minio.putProjectMeta(projectId, {
    name,
    type: 'nodejs',
    createdAt: new Date().toISOString(),
  });

  for (const [path, content] of Object.entries(templateFiles)) {
    await minio.putFile(projectId, path, content);
  }

  return res.status(201).json({ projectId, name, files: Object.keys(templateFiles) });
});

// GET /projects
// Returns: [{ projectId, name, type, createdAt }]
router.get('/', async (req, res) => {
  const projects = await minio.listAllProjects();
  return res.json(projects);
});

// GET /projects/:id
router.get('/:id', async (req, res) => {
  try {
    const meta = await minio.getProjectMeta(req.params.id);
    return res.json({ projectId: req.params.id, ...meta });
  } catch {
    return res.status(404).json({ error: 'Project not found' });
  }
});

// DELETE /projects/:id
router.delete('/:id', async (req, res) => {
  try {
    await minio.getProjectMeta(req.params.id); // verify exists
    await minio.deleteProject(req.params.id);
    return res.status(204).send();
  } catch {
    return res.status(404).json({ error: 'Project not found' });
  }
});

// GET /projects/:id/files
router.get('/:id/files', async (req, res) => {
  try {
    await minio.getProjectMeta(req.params.id);
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
    await minio.getProjectMeta(req.params.id); // verify project exists
    await minio.putFile(req.params.id, filePath, content);
    return res.status(204).send();
  } catch {
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

// POST /projects/:id/deploy  — stubbed; implemented in Phase 2
router.post('/:id/deploy', async (req, res) => {
  return res.status(501).json({ error: 'Deploy not yet implemented (Phase 2)' });
});

module.exports = { router };
