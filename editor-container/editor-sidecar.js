'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const { spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const { PROJECT_ID } = process.env;

const WORKSPACE = '/workspace';

// ---------------------------------------------------------------------------
// FUSE mount readiness check
// ---------------------------------------------------------------------------

async function waitForFuseMount() {
  const TIMEOUT_MS = 15_000;
  const start = Date.now();
  while (true) {
    try {
      await fs.readdir(WORKSPACE);
      console.log('[fuse] /workspace is accessible');
      return;
    } catch (e) {
      if (Date.now() - start > TIMEOUT_MS)
        throw new Error(`[fuse] /workspace not accessible after ${TIMEOUT_MS}ms: ${e.message}`);
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

// ---------------------------------------------------------------------------
// Step 1 — npm install (guarded by package-lock.json hash)
// ---------------------------------------------------------------------------

async function checkAndInstall() {
  const lockFilePath = path.join(WORKSPACE, 'package-lock.json');
  let lockContent;
  try {
    lockContent = await fs.readFile(lockFilePath);
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.log('[npm] No package-lock.json found — skipping npm install');
      return;
    }
    throw e;
  }

  const hash = crypto.createHash('sha256').update(lockContent).digest('hex');
  const hashFilePath = path.join(WORKSPACE, 'node_modules', '.install-hash');

  let existingHash = null;
  try {
    existingHash = (await fs.readFile(hashFilePath, 'utf8')).trim();
  } catch {
    // hash file doesn't exist yet — that's fine
  }

  if (existingHash === hash) {
    console.log('[npm] node_modules up to date — skipping npm install');
    return;
  }

  console.log('[npm] Running npm install...');
  await new Promise((resolve, reject) => {
    const proc = spawn('npm', ['install', '--prefix', WORKSPACE], {
      stdio: 'inherit',
    });
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm install exited with code ${code}`));
    });
    proc.on('error', reject);
  });

  await fs.writeFile(hashFilePath, hash);
  console.log('[npm] Install complete');
}

// ---------------------------------------------------------------------------
// Step 2 — HTTP server on port 5003
// ---------------------------------------------------------------------------

function startHttpServer() {
  const server = http.createServer((req, res) => {
    const urlPath = req.url || '/';

    // GET /health
    if (req.method === 'GET' && urlPath === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ lspRunning: true }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(5003, () => console.log('[http] Listening on port 5003'));
}

// ---------------------------------------------------------------------------
// Step 3 — PTY WebSocket server on port 9999
// ---------------------------------------------------------------------------
//
// Protocol (mirrors PtyWebSocketHandler.cs in os-process-manager-service):
//   Client → Server  binary frame : raw keystroke bytes → PTY stdin
//   Client → Server  text frame   : {"type":"resize","cols":80,"rows":24} → pty.resize()
//   Server → Client  binary frame : raw PTY stdout bytes → xterm.js terminal.write()

function startPtyServer() {
  const ptyWss = new WebSocketServer({ port: 9999 });

  ptyWss.on('connection', (ws) => {
    // Strip host-injected Node.js debugger vars from the shell environment.
    // NODE_OPTIONS may contain --require paths pointing to the host machine
    // (e.g. VS Code's bootloader.js on Windows) which don't exist inside the container.
    const { NODE_OPTIONS, NODE_PATH, ...shellEnv } = process.env;

    const shell = pty.spawn('bash', [], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: '/workspace',
      env: shellEnv,
    });

    // PTY stdout → browser (binary frame)
    shell.onData((data) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(Buffer.from(data), { binary: true });
      }
    });

    // Browser → PTY stdin (binary) or resize message (text)
    ws.on('message', (msg, isBinary) => {
      if (isBinary) {
        shell.write(msg.toString()); // node-pty write() expects a string
      } else {
        try {
          const parsed = JSON.parse(msg.toString());
          if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
            shell.resize(parsed.cols, parsed.rows);
          }
        } catch (_) {
          // ignore malformed text frames
        }
      }
    });

    ws.on('close', () => shell.kill());
    ws.on('error', () => shell.kill());

    shell.onExit(() => {
      if (ws.readyState === ws.OPEN) ws.close();
    });
  });

  ptyWss.on('listening', () => console.log('[pty] WebSocket server listening on port 9999'));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`[sidecar] Starting for project "${PROJECT_ID}"`);

  await waitForFuseMount(); // wait for rclone FUSE mount (entrypoint.sh already confirmed it, belt-and-suspenders)
  await checkAndInstall();

  startHttpServer(); // port 5003
  startPtyServer();  // port 9999

  console.log('[sidecar] All services started');
}

main().catch((e) => {
  console.error('[sidecar] Fatal error:', e);
  process.exit(1);
});
