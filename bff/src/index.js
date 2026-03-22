const http = require('http');
const express = require('express');
const cors = require('cors');
const { router: sessionsRouter } = require('./routes/sessions');
const { router: projectsRouter } = require('./routes/projects');
const { router: deploymentsRouter } = require('./routes/deployments');
const { attachPtyProxy } = require('./proxy/ptyProxy');
const { ensureBucket } = require('./services/minioClient');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// REST routes
app.use('/sessions', sessionsRouter);
app.use('/projects', projectsRouter);
app.use('/deployments', deploymentsRouter);

// Single http.Server so that Express (HTTP) and the WS proxy share the same port
const server = http.createServer(app);

// WebSocket upgrade handler for /proxy/:sessionId → sidecar ws://host:port/pty
attachPtyProxy(server);

(async () => {
  await ensureBucket();
  server.listen(PORT, () => {
    console.log(`container-management-studio BFF listening on port ${PORT}`);
  });
})();
