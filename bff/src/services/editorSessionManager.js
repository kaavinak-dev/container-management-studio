const axios = require('axios');

const BACKEND_URL = process.env.CONTAINER_MANAGEMENT_URL || 'http://127.0.0.1:5235';

// Map<projectId, { containerIp, fileApiPort, lastActivity: Date }>
const sessions = new Map();

async function ensureSession(projectId) {
  if (sessions.has(projectId)) {
    sessions.get(projectId).lastActivity = new Date();
    return sessions.get(projectId);
  }
  console.log("Starting editor session for projectId:", projectId);
  const { data } = await axios.post(`${BACKEND_URL}/api/editor-sessions`, { projectId });
  console.log("Editor session started for projectId:", projectId,data);
  const session = {
    containerIp: data.containerIp,
    fileApiPort: data.fileApiPort,
    lastActivity: new Date(),
  };
  sessions.set(projectId, session);
  return session;
}

function touchSession(projectId) {
  const session = sessions.get(projectId);
  if (!session) return;
  session.lastActivity = new Date();
  // fire-and-forget — do not await or block on failures
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
