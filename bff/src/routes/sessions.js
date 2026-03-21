const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');

const router = Router();

// In-memory session store: Map<sessionId, { host, port, label }>
// No password field — PTY has no auth (unlike VNC)
const sessions = new Map();

// POST /sessions
// Body: { host: string, port: number, label?: string }
// Returns: { sessionId: string, wsUrl: string }
router.post('/', (req, res) => {
  const { host, port, label } = req.body;

  if (!host || port === undefined || port === null) {
    return res.status(400).json({ error: 'host and port are required' });
  }

  const sessionId = uuidv4();
  sessions.set(sessionId, { host, port: Number(port), label: label || '' });

  const publicHost = process.env.PUBLIC_HOST || `${req.hostname}:${process.env.PORT || 3000}`;
  const wsUrl = `wss://${publicHost}/proxy/${sessionId}`;

  return res.status(201).json({ sessionId, wsUrl });
});

// GET /sessions/:id
// Returns: { sessionId, host, port, label }  — never exposes a password
router.get('/:id', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  return res.json({ sessionId: req.params.id, ...session });
});

// DELETE /sessions/:id
// Called by container-management when a container is stopped
router.delete('/:id', (req, res) => {
  if (!sessions.has(req.params.id)) {
    return res.status(404).json({ error: 'Session not found' });
  }
  sessions.delete(req.params.id);
  return res.status(204).send();
});

module.exports = { router, sessions };
