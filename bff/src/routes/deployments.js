const express = require('express');
const { getDeploymentSteps } = require('../services/backendClient');

const router = express.Router();

function isTerminal(steps) {
  if (!steps || steps.length === 0) return false;
  const allDone = steps.every(s => s.status === 'completed' || s.status === 'skipped');
  const anyFailed = steps.some(s => s.status === 'failed');
  return allDone || anyFailed;
}

// GET /deployments/:executableProjectId/steps
// Returns current deployment step status as JSON (simple polling endpoint).
router.get('/:executableProjectId/steps', async (req, res) => {
  const { executableProjectId } = req.params;
  try {
    const steps = await getDeploymentSteps(executableProjectId);
    res.json(steps);
  } catch (err) {
    if (err.response?.status === 404) {
      return res.status(404).json({ error: 'No deployment status found' });
    }
    console.error('Error fetching deployment steps:', err.message);
    res.status(502).json({ error: 'Failed to fetch deployment status' });
  }
});

// GET /deployments/:executableProjectId/steps/stream
// Server-Sent Events endpoint — pushes step snapshots every second until terminal state.
router.get('/:executableProjectId/steps/stream', (req, res) => {
  const { executableProjectId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const interval = setInterval(async () => {
    try {
      const steps = await getDeploymentSteps(executableProjectId);
      send('steps', steps);
      if (isTerminal(steps)) {
        clearInterval(interval);
        res.end();
      }
    } catch (err) {
      if (err.response?.status === 404) {
        send('error', { error: 'No deployment status found' });
        clearInterval(interval);
        res.end();
        return;
      }
      console.error('SSE poll error:', err.message);
    }
  }, 1000);

  req.on('close', () => clearInterval(interval));
});

module.exports = { router };
