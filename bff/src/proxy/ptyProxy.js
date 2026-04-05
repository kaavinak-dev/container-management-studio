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
    const sidecarUrl = `ws://${host}:${port}/pty`;

    // Open upstream connection to the container's PTY sidecar
    const sidecarWs = new WebSocket(sidecarUrl);

    // Buffer browser messages that arrive before the sidecar connection is open
    const pending = [];
    let sidecarReady = false;

    sidecarWs.on('open', () => {
      sidecarReady = true;
      // Drain anything buffered while connecting
      for (const { data, isBinary } of pending) {
        sidecarWs.send(data, { binary: isBinary });
      }
      pending.length = 0;
    });

    sidecarWs.on('error', () => {
      // Sidecar unreachable (not started yet, wrong IP, etc.)
      browserWs.close(WS_CLOSE_SIDECAR_UNREACHABLE, 'Sidecar unreachable');
    });

    sidecarWs.on('close', () => {
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
        pending.push({ data, isBinary });
        return;
      }
      if (sidecarWs.readyState === WebSocket.OPEN) {
        sidecarWs.send(data, { binary: isBinary });
      }
    });

    browserWs.on('close', () => {
      if (sidecarWs.readyState === WebSocket.OPEN ||
          sidecarWs.readyState === WebSocket.CONNECTING) {
        sidecarWs.close();
      }
    });

    browserWs.on('error', () => {
      sidecarWs.terminate();
    });
  });
}

module.exports = { attachPtyProxy };
