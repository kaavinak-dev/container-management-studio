const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { ensureSession, touchSession, sessions: editorSessions } = require('../services/editorSessionManager');
const { sessions: proxySessions } = require('./sessions');

const router = Router();

// POST /editor-sessions
// Browser calls this when opening the editor. Blocks until container is ready (~3 min cold start).
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
// Browser calls every 60 seconds to signal the user is still active.
router.post('/:projectId/heartbeat', (req, res) => {
  touchSession(req.params.projectId);
  return res.sendStatus(200);
});

// POST /editor-sessions/:projectId/terminal
// Creates a PTY proxy session for the editor container and returns a sessionId.
// The browser connects to ws(s)://host/proxy/:sessionId to get a live bash shell.
// Awaits ensureSession so it blocks naturally if the container is still starting,
// rather than doing a blind Map lookup that would return 404 during cold start.
router.post('/:projectId/terminal', async (req, res) => {
  const { projectId } = req.params;

  let session;
  try {
    session = await ensureSession(projectId);
  } catch (err) {
    console.error('[editor-sessions] ensureSession failed for terminal:', err.message);
    return res.status(502).json({ error: 'Failed to start editor session', detail: err.message });
  }

  const sessionId = uuidv4();
  proxySessions.set(sessionId, {
    host:  session.containerIp,
    port:  session.ptyPort,
    label: `editor-pty-${projectId}`,
  });

  return res.json({ sessionId });
});

module.exports = { router };
