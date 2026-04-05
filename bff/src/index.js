const http = require('http');
const express = require('express');
const cors = require('cors');
const { router: sessionsRouter } = require('./routes/sessions');
const { router: projectsRouter } = require('./routes/projects');
const { router: deploymentsRouter } = require('./routes/deployments');
const { router: editorSessionsRouter } = require('./routes/editorSessions');
const { attachPtyProxy } = require('./proxy/ptyProxy');
const { ensureBucket, initProjectMappings } = require('./services/minioClient');
const backend = require('./services/backendClient');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// REST routes
app.use('/sessions', sessionsRouter);
app.use('/projects', projectsRouter);
app.use('/deployments', deploymentsRouter);
app.use('/editor-sessions', editorSessionsRouter);

// Single http.Server so that Express (HTTP) and the WS proxy share the same port
const server = http.createServer(app);

// WebSocket upgrade handler for /proxy/:sessionId → sidecar ws://host:port/pty
attachPtyProxy(server);

(async () => {
  //await ensureBucket();
  try {
    await ensureBucket();
    } catch (err) {
      console.warn('[minio] could not ensure bucket on startup:', err.message);
    }

  try {
    const projects = await backend.listProjects();
    initProjectMappings(projects);
    console.log(`[minio-election] loaded ${projects.length} project→server mappings`);
  } catch (err) {
    console.warn('[minio-election] could not load project mappings on startup:', err.message);
  }

  server.listen(PORT, () => {
    console.log(`container-management-studio BFF listening on port ${PORT}`);
  });
})();
