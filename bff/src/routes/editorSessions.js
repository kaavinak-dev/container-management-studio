const { Router } = require('express');
const { ensureSession, touchSession } = require('../services/editorSessionManager');

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

module.exports = { router };
