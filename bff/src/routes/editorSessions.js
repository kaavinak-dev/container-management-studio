const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { ensureSession, touchSession, sessions: editorSessions } = require('../services/editorSessionManager');
const { sessions: proxySessions } = require('./sessions');

const router = Router();

// POST /editor-sessions
router.post('/', async (req, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });

  try {
    console.log("Starting editor session for projectId:", projectId);
    await ensureSession(projectId);
    console.log("Editor session started for projectId:", projectId);
    return res.json({ sessionReady: true });
  } catch (err) {
    console.error('[editor-sessions] ensureSession failed:', err.message);
    return res.status(502).json({ error: 'Failed to start editor session', detail: err.message });
  }
});

// POST /editor-sessions/:projectId/heartbeat
router.post('/:projectId/heartbeat', (req, res) => {
  touchSession(req.params.projectId);
  return res.sendStatus(200);
});

// POST /editor-sessions/:projectId/terminal
router.post('/:projectId/terminal', async (req, res) => {
  const { projectId } = req.params;

  const session = editorSessions.get(projectId);
  if (!session) {
    return res.status(409).json({ error: 'No active editor session for this project. Open the project first.' });
  }

  const sessionId = uuidv4();
  proxySessions.set(sessionId, {
    host:  session.containerIp,
    port:  session.ptyPort,
    label: `editor-pty-${projectId}`,
    agentId: session.agentId,        // Remote agent ID
    containerId: session.containerId, // Container ID on that agent
    projectId: projectId,            // Security context
  });

  return res.json({ sessionId });
});

module.exports = { router };
