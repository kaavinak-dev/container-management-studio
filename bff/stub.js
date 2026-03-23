/**
 * Stub BFF for Claude Code Web preview.
 *
 * Replaces the real BFF (which needs MinIO + .NET backend) with in-memory
 * mock data so the Next.js dev server can render fully without any external
 * services. Start alongside the Next.js dev server:
 *
 *   npm run dev:preview   (root package.json)
 *
 * Listens on the same port as the real BFF (3000) so next.config.mjs proxy
 * rewrites work without any changes.
 */

const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ─── In-memory store ────────────────────────────────────────────────────────

const MOCK_FILES = {
  'index.js': `const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Hello from container!\\n');
});
server.listen(3000, () => console.log('Listening on :3000'));
`,
  'package.json': JSON.stringify({ name: 'my-app', version: '1.0.0', main: 'index.js' }, null, 2),
  'README.md': '# My App\n\nA simple Node.js app deployed on the container platform.\n',
};

const projects = new Map([
  ['proj-001', {
    projectId: 'proj-001',
    projectName: 'hello-world',
    projectType: 'js',
    status: 'running',
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    files: { ...MOCK_FILES },
  }],
  ['proj-002', {
    projectId: 'proj-002',
    projectName: 'api-service',
    projectType: 'js',
    status: 'stopped',
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    files: {
      'server.js': `const express = require('express');
const app = express();
app.get('/health', (_, res) => res.json({ ok: true }));
app.listen(4000);
`,
      'package.json': JSON.stringify({ name: 'api-service', version: '1.0.0', main: 'server.js', dependencies: { express: '^4' } }, null, 2),
    },
  }],
  ['proj-003', {
    projectId: 'proj-003',
    projectName: 'data-pipeline',
    projectType: 'js',
    status: 'error',
    createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    files: { ...MOCK_FILES },
  }],
]);

const sessions = new Map();

const deployments = new Map();

// ─── Helper ─────────────────────────────────────────────────────────────────

function projectList() {
  return [...projects.values()].map(({ files: _f, ...rest }) => rest);
}

// ─── /projects ──────────────────────────────────────────────────────────────

app.get('/projects', (_req, res) => {
  res.json(projectList());
});

app.post('/projects', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const projectId = `proj-${uuidv4().slice(0, 6)}`;
  const now = new Date().toISOString();
  projects.set(projectId, {
    projectId,
    projectName: name,
    projectType: 'js',
    status: 'stopped',
    createdAt: now,
    files: { ...MOCK_FILES },
  });
  const { files: _f, ...rest } = projects.get(projectId);
  return res.status(201).json({ ...rest, files: Object.keys(MOCK_FILES) });
});

app.get('/projects/:id', (req, res) => {
  const p = projects.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const { files: _f, ...rest } = p;
  res.json(rest);
});

app.delete('/projects/:id', (req, res) => {
  if (!projects.has(req.params.id)) return res.status(404).json({ error: 'Project not found' });
  projects.delete(req.params.id);
  res.status(204).send();
});

// ─── /projects/:id/files ─────────────────────────────────────────────────────

app.get('/projects/:id/files', (req, res) => {
  const p = projects.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  res.json({ files: Object.keys(p.files) });
});

app.get('/projects/:id/files/*', (req, res) => {
  const p = projects.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const filePath = req.params[0];
  if (!(filePath in p.files)) return res.status(404).json({ error: 'File not found' });
  res.json({ content: p.files[filePath] });
});

app.put('/projects/:id/files/*', (req, res) => {
  const p = projects.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const filePath = req.params[0];
  const { content } = req.body;
  if (content === undefined) return res.status(400).json({ error: 'content is required' });
  p.files[filePath] = content;
  res.status(204).send();
});

app.delete('/projects/:id/files/*', (req, res) => {
  const p = projects.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const filePath = req.params[0];
  if (!(filePath in p.files)) return res.status(404).json({ error: 'File not found' });
  delete p.files[filePath];
  res.status(204).send();
});

// ─── /projects/:id/deploy ────────────────────────────────────────────────────

app.post('/projects/:id/deploy', (req, res) => {
  const p = projects.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const executableProjectId = `exec-${uuidv4().slice(0, 8)}`;
  deployments.set(executableProjectId, {
    projectId: req.params.id,
    startedAt: Date.now(),
    steps: [
      { name: 'Upload', status: 'pending', message: null },
      { name: 'Virus Scan', status: 'pending', message: null },
      { name: 'npm audit', status: 'pending', message: null },
      { name: 'Build Container', status: 'pending', message: null },
      { name: 'Start Container', status: 'pending', message: null },
    ],
  });
  // Simulate step progression in background
  simulateDeploy(executableProjectId);
  res.status(202).json({ executableProjectId });
});

function simulateDeploy(executableProjectId) {
  const d = deployments.get(executableProjectId);
  if (!d) return;
  let i = 0;
  const tick = setInterval(() => {
    if (i < d.steps.length) {
      if (i > 0) d.steps[i - 1].status = 'completed';
      d.steps[i].status = 'running';
      i++;
    } else {
      d.steps[d.steps.length - 1].status = 'completed';
      clearInterval(tick);
    }
  }, 1500);
}

// ─── /deployments/:id/steps ──────────────────────────────────────────────────

app.get('/deployments/:executableProjectId/steps', (req, res) => {
  const d = deployments.get(req.params.executableProjectId);
  if (!d) return res.status(404).json({ error: 'No deployment status found' });
  res.json(d.steps);
});

app.get('/deployments/:executableProjectId/steps/stream', (req, res) => {
  const d = deployments.get(req.params.executableProjectId);
  if (!d) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'No deployment status found' })}\n\n`);
    return res.end();
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const isTerminal = (steps) =>
    steps.every(s => s.status === 'completed' || s.status === 'skipped') ||
    steps.some(s => s.status === 'failed');

  const interval = setInterval(() => {
    send('steps', d.steps);
    if (isTerminal(d.steps)) {
      clearInterval(interval);
      res.end();
    }
  }, 1000);

  req.on('close', () => clearInterval(interval));
});

// ─── /sessions ───────────────────────────────────────────────────────────────

app.post('/sessions', (req, res) => {
  const { host, port, label } = req.body;
  if (!host || port === undefined) return res.status(400).json({ error: 'host and port are required' });
  const sessionId = uuidv4();
  sessions.set(sessionId, { host, port: Number(port), label: label || '' });
  const publicHost = `${req.hostname}:${PORT}`;
  res.status(201).json({ sessionId, wsUrl: `wss://${publicHost}/proxy/${sessionId}` });
});

app.get('/sessions/:id', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  res.json({ sessionId: req.params.id, ...s });
});

app.delete('/sessions/:id', (req, res) => {
  if (!sessions.has(req.params.id)) return res.status(404).json({ error: 'Session not found' });
  sessions.delete(req.params.id);
  res.status(204).send();
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[stub-bff] Mock BFF listening on http://localhost:${PORT}`);
  console.log('[stub-bff] All MinIO/backend calls replaced with in-memory mock data.');
});
