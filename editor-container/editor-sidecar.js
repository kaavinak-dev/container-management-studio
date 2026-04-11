'use strict';

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
// Step 2 — PTY WebSocket server on port 9999
// ---------------------------------------------------------------------------
//
// Protocol (mirrors PtyWebSocketHandler.cs in os-process-manager-service):
//   Client → Server  binary frame : raw keystroke bytes → PTY stdin
//   Client → Server  text frame   : {"type":"resize","cols":80,"rows":24} → pty.resize()
//   Server → Client  binary frame : raw PTY stdout bytes → xterm.js terminal.write()

function startPtyServer() {
  const ptyWss = new WebSocketServer({ port: 9999 });

  // ── ptyWss 'connection' ──────────────────────────────────────────────
  // TRIGGERED BY:
  //   LOCAL  path: ptyProxy.js creates `new WebSocket(sidecarUrl)` at line ~90
  //                which connects directly to this port (9999) on the container IP.
  //   REMOTE path: relay-agent/index.js creates `new WebSocket(sidecarUrl)` at line ~155
  //                after receiving an 'open_pty' command from the BFF.
  //
  // FLOW:
  //   Browser → BFF ptyProxy (WS upgrade on /proxy/:sessionId)
  //     → LOCAL:  BFF opens WS to container_ip:9999 directly
  //     → REMOTE: BFF sends 'open_pty' command to relay-agent via agentProxy
  //               → relay-agent opens WS to container_ip:9999
  //   Either way, this handler fires when that upstream WS connects.
  //
  // PURPOSE:
  //   Spawns a bash PTY (via node-pty) for the new connection and wires up
  //   bidirectional data flow: PTY stdout → WS binary frames, WS input → PTY stdin.
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

    // ── shell.onData ───────────────────────────────────────────────────
    // TRIGGERED BY: The bash PTY produces output (command results, prompts, etc.)
    //
    // FLOW:
    //   PTY stdout → this handler → ws.send(binary)
    //     → LOCAL:  arrives at ptyProxy.js sidecarWs 'message' (line ~131) → browserWs.send()
    //     → REMOTE: arrives at relay-agent sidecarWs 'message' (line ~169)
    //               → relay-agent sends JSON {type:'data'} to BFF
    //               → agentProxy.js ws 'message' (line ~59) routes to browserWs
    //   Finally: browser xterm.js terminal.write() renders the output.
    //
    // PURPOSE: Streams raw PTY output bytes to the upstream WebSocket client.
    shell.onData((data) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(Buffer.from(data), { binary: true });
      }
    });

    // ── ws 'message' ───────────────────────────────────────────────────
    // TRIGGERED BY:
    //   LOCAL:  ptyProxy.js browserWs 'message' (line ~137) → sidecarWs.send()
    //   REMOTE: relay-agent ws 'message' handler (line ~73) receives {type:'data'}
    //           from BFF → sidecarWs.send()
    //
    // FLOW:
    //   Browser xterm.js onData (keystroke) → BFF ptyProxy → [local or relay-agent] → here
    //   Binary frames = raw keystrokes → written to PTY stdin
    //   Text frames   = JSON resize commands → shell.resize()
    //
    // PURPOSE: Feeds user keystrokes into the PTY and handles terminal resize requests.
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

    // ── ws 'close' ─────────────────────────────────────────────────────
    // TRIGGERED BY:
    //   LOCAL:  ptyProxy.js browserWs 'close' (line ~153) calls sidecarWs.close()
    //   REMOTE: relay-agent handleCommand 'close_pty' (line ~205) calls session.close()
    //           (fired when browser disconnects → ptyProxy cleanup → sendCommand 'close_pty')
    //
    // PURPOSE: Kills the bash PTY process when the upstream client disconnects,
    //          preventing orphaned shell processes inside the container.
    ws.on('close', () => shell.kill());

    // ── ws 'error' ─────────────────────────────────────────────────────
    // TRIGGERED BY: Network error on the WebSocket (e.g. relay-agent crashes, TCP reset).
    // PURPOSE: Same as 'close' — ensures the PTY is cleaned up on error.
    ws.on('error', () => shell.kill());

    // ── shell.onExit ───────────────────────────────────────────────────
    // TRIGGERED BY: The bash process exits (user types `exit`, process killed, etc.)
    //
    // FLOW:
    //   shell exits → ws.close()
    //     → LOCAL:  ptyProxy.js sidecarWs 'close' (line ~124) → browserWs.close(1000)
    //     → REMOTE: relay-agent sidecarWs 'close' (line ~191) → sends {type:'event',
    //               event:'sidecar_closed'} to BFF → agentProxy.js routes to browserWs.close()
    //   Browser receives close frame → terminal shows disconnected state.
    //
    // PURPOSE: Propagates shell exit back to the browser so the terminal UI
    //          can show "session ended" instead of hanging.
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

  startPtyServer();  // port 9999

  console.log('[sidecar] All services started');
}

main().catch((e) => {
  console.error('[sidecar] Fatal error:', e);
  process.exit(1);
});
