// Exact content mirrored from container-management/TestProjects/SimpleNodeApp/
// JSProjectUploadStrategy requires: package.json at root, valid Node project, no node_modules/.git

const PACKAGE_JSON = `{
  "name": "simple-node-app",
  "version": "1.0.0",
  "description": "Test project for container management E2E testing",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "express": "^4.18.2"
  }
}
`;

const INDEX_JS = `const express = require("express");
const app = express();
const PORT = 3000;

app.get("/", (req, res) => {
  res.json({
    status: "running",
    project: "simple-node-app",
    pid: process.pid,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(\`Simple Node App listening on port \${PORT}\`);
});
`;

module.exports = {
  files: {
    'package.json': PACKAGE_JSON,
    'index.js':     INDEX_JS,
  },
};
