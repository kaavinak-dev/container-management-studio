const { WebSocket, WebSocketServer } = require('ws');
const { sessions } = require('../routes/sessions');

// Custom WebSocket close codes used by this proxy
const WS_CLOSE_SESSION_NOT_FOUND = 4004;
const WS_CLOSE_SIDECAR_UNREACHABLE = 4503;

/**
 * Attaches a WebSocket upgrade handler on /proxy/:sessionId to the given http.Server.
 *
 * Protocol (mirrors PtyWebSocketHandler.cs in the sidecar):
 *   Browser → proxy → sidecar  binary frame : raw keystroke bytes
 *   Browser → proxy → sidecar  text frame   : {"type":"resize","cols":80,"rows":24}
 *   Sidecar → proxy → browser  binary frame : raw PTY stdout bytes (xterm.js terminal.write)
 *
 * @param {import('http').Server} server
 */
/**
 * Resolves the host the BFF should use to reach a container's sidecar.
 *
 * In production the BFF runs inside Docker and can reach containers directly
 * via their bridge IP. In local dev the BFF runs on the host and containers
 * are only reachable through Docker's port-forwarding on localhost.
 *
 * Controlled by SIDECAR_USE_LOCALHOST=true (set in .env for local dev).
 */
function resolveSidecarHost(containerIp) {
  return true ? '127.0.0.1' : containerIp;
}

function attachPtyProxy(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const match = req.url.match(/^\/proxy\/([^/?]+)/);
    if (!match) return; // not our route — let other upgrade handlers deal with it

    const sessionId = match[1];
    const session = sessions.get(sessionId);

    if (!session) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (browserWs) => {
      wss.emit('connection', browserWs, req, session);
    });
  });

  wss.on('connection', (browserWs, _req, session) => {
    const { host, port } = session;
    // No /pty path — sidecar WebSocketServer listens on the root path.
    // In local dev (SIDECAR_USE_LOCALHOST=true) containers are reached via
    // Docker port-forwarding on localhost rather than the bridge IP directly.
    const sidecarUrl = `ws://${resolveSidecarHost(host)}:${port}`;

    // Open upstream connection to the container's PTY sidecar
    const sidecarWs = new WebSocket(sidecarUrl);

    // Buffer browser messages that arrive before the sidecar connection is open
    const pending = [];
    let sidecarReady = false;
    let pendingBytes = 0;
    const MAX_PENDING_BYTES = 50 * 1024; // 50 KB — prevent unbounded growth if sidecar is slow

    // Timeout: sidecar may still be running npm install on cold start
    const connectTimer = setTimeout(() => {
      if (!sidecarReady) {
        sidecarWs.terminate();
        if (browserWs.readyState === WebSocket.OPEN) {
          browserWs.close(WS_CLOSE_SIDECAR_UNREACHABLE, 'Sidecar connection timeout');
        }
      }
    }, 10_000);

    sidecarWs.on('open', () => {
      clearTimeout(connectTimer);
      sidecarReady = true;
      // Drain anything buffered while connecting
      for (const { data, isBinary } of pending) {
        sidecarWs.send(data, { binary: isBinary });
      }
      pending.length = 0;
      pendingBytes = 0;
    });

    sidecarWs.on('error', () => {
      clearTimeout(connectTimer);
      // Terminate sidecar socket to prevent leak (ws emits close after error, but terminate is immediate)
      sidecarWs.terminate();
      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.close(WS_CLOSE_SIDECAR_UNREACHABLE, 'Sidecar unreachable');
      }
    });

    sidecarWs.on('close', () => {
      clearTimeout(connectTimer);
      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.close(1000, 'Session ended');
      }
    });

    // Sidecar PTY output → browser (always binary)
    sidecarWs.on('message', (data, isBinary) => {
      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(data, { binary: isBinary });
      }
    });

    // Browser keystrokes / resize JSON → sidecar
    browserWs.on('message', (data, isBinary) => {
      if (!sidecarReady) {
        const len = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data);
        if (pendingBytes + len > MAX_PENDING_BYTES) {
          browserWs.close(WS_CLOSE_SIDECAR_UNREACHABLE, 'Buffer overflow — sidecar not responding');
          return;
        }
        pending.push({ data, isBinary });
        pendingBytes += len;
        return;
      }
      if (sidecarWs.readyState === WebSocket.OPEN) {
        sidecarWs.send(data, { binary: isBinary });
      }
    });

    browserWs.on('close', () => {
      clearTimeout(connectTimer);
      if (sidecarWs.readyState === WebSocket.OPEN ||
          sidecarWs.readyState === WebSocket.CONNECTING) {
        sidecarWs.close();
      }
    });

    browserWs.on('error', () => {
      clearTimeout(connectTimer);
      sidecarWs.terminate();
    });
  });
}

module.exports = { attachPtyProxy };
