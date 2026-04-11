const axios = require('axios');

const BACKEND_URL = process.env.CONTAINER_MANAGEMENT_URL || 'http://127.0.0.1:5235';

// Map<projectId, { containerIp, ptyPort, agentId, containerId, lastActivity: Date }>
const sessions = new Map();
// Map<projectId, Promise> — deduplicates concurrent ensureSession calls for the same project
const inFlight = new Map();

async function ensureSession(projectId) {
  if (sessions.has(projectId)) {
    sessions.get(projectId).lastActivity = new Date();
    return sessions.get(projectId);
  }

  // Return the same promise if a backend call is already in progress for this project.
  if (inFlight.has(projectId)) {
    return inFlight.get(projectId);
  }

  console.log("Starting editor session for projectId:", projectId);
  const promise = axios
    .post(`${BACKEND_URL}/api/editor-sessions`, { projectId })
    .then(({ data }) => {
      console.log("Editor session started for projectId:", projectId, data);
      const session = {
        containerIp: data.containerIp,
        ptyPort: data.ptyPort,
        agentId: data.agentId,        // From .NET backend
        containerId: data.containerId, // From .NET backend
        lastActivity: new Date(),
      };
      sessions.set(projectId, session);
      return session;
    })
    .finally(() => {
      inFlight.delete(projectId);
    });

  inFlight.set(projectId, promise);
  return promise;
}

function touchSession(projectId) {
  const session = sessions.get(projectId);
  if (!session) return;
  session.lastActivity = new Date();
  axios.put(`${BACKEND_URL}/api/editor-sessions/${projectId}/activity`).catch(() => {});
}

async function stopSession(projectId) {
  await axios.delete(`${BACKEND_URL}/api/editor-sessions/${projectId}`).catch(() => {});
  sessions.delete(projectId);
}

// Inactivity cleanup: runs every 60 seconds, stops sessions idle for more than 2 hours
setInterval(async () => {
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  for (const [projectId, session] of sessions) {
    if (Date.now() - session.lastActivity.getTime() > TWO_HOURS) {
      console.log(`[editor-sessions] stopping idle session for project ${projectId}`);
      await stopSession(projectId).catch(() => {});
    }
  }
}, 60_000);

module.exports = { sessions, ensureSession, touchSession, stopSession };
