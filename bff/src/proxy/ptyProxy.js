const { WebSocket, WebSocketServer } = require('ws');
const { sessions } = require('../routes/sessions');
const { browserSessions, sendCommand, sendDataToAgent } = require('../services/agentRegistry');

// Custom WebSocket close codes
const WS_CLOSE_SESSION_NOT_FOUND = 4004;
const WS_CLOSE_SIDECAR_UNREACHABLE = 4503;

function resolveSidecarHost(containerIp) {
  return containerIp;
}

function attachPtyProxy(server) {
  const wss = new WebSocketServer({ noServer: true });

  // ── server 'upgrade' ─────────────────────────────────────────────────
  // TRIGGERED BY: Browser initiates a WebSocket connection to /proxy/:sessionId
  //   (React xterm.js component calls `new WebSocket('wss://host/proxy/<sessionId>')`)
  //
  // FLOW:
  //   1. Browser opens WS to /proxy/:sessionId
  //   2. This handler extracts sessionId from URL, looks up session in sessions Map
  //      (populated by editorSessions.js POST /:projectId/terminal)
  //   3. If found, upgrades HTTP → WebSocket and emits 'connection'
  //
  // PURPOSE: Guards WebSocket upgrades — only allows connections for known sessions.
  //          Rejects unknown session IDs with 404 before the upgrade completes.
  server.on('upgrade', (req, socket, head) => {
    const match = req.url.match(/^\/proxy\/([^/?]+)/);
    if (!match) return;

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

  // ── wss 'connection' ─────────────────────────────────────────────────
  // TRIGGERED BY: server 'upgrade' above, after successful handleUpgrade.
  //
  // FLOW:
  //   This handler decides between two routing paths based on session.agentId:
  //     A) REMOTE (agentId present): route via relay-agent (agent-based PTY relay)
  //     B) LOCAL  (no agentId):      connect directly to sidecar container IP:port
  //
  // PURPOSE: Central routing point for all terminal WebSocket connections.
  wss.on('connection', (browserWs, req, session) => {
    const match = req.url.match(/^\/proxy\/([^/?]+)/);
    const sessionId = match ? match[1] : null;
    const { host, port, agentId, containerId, projectId } = session;

    // Handle Remote Agent routing
    if (agentId && sessionId) {
      console.log(`[pty-proxy] Routing session ${sessionId} via agent ${agentId}`);

      browserSessions.set(sessionId, browserWs);

      // Drop or forward browser messages depending on whether the sidecar is ready.
      // Messages that arrive before the relay agent acks open_pty are queued here.
      const messageQueue = [];
      let sidecarReady = false;

      // ── browserWs 'message' (REMOTE path) ────────────────────────────
      // TRIGGERED BY: Browser xterm.js sends keystrokes or resize commands.
      //
      // FLOW:
      //   Browser keystroke → this handler
      //     → if sidecarReady: sendDataToAgent() → agentRegistry wraps as {type:'data'}
      //       → agentProxy sends to relay-agent WS → relay-agent forwards to sidecar
      //     → if NOT ready: queued in messageQueue, flushed when onOpenPtyAck fires
      //
      // PURPOSE: Forwards browser terminal input to the remote sidecar via the
      //          relay-agent. Queues messages during the brief window between
      //          browser connect and sidecar PTY being ready.
      browserWs.on('message', (data, isBinary) => {
        if (sidecarReady) {
          sendDataToAgent(agentId, sessionId, data, isBinary);
        } else {
          messageQueue.push({ data, isBinary });
        }
      });

      // Called by agentProxy when the relay agent sends back its open_pty ack.
      function onOpenPtyAck(ack) {
        if (!ack.success) {
          browserWs.close(4503, ack.error || 'Relay agent failed to open PTY');
          return;
        }
        sidecarReady = true;
        // Flush any browser messages that arrived while the sidecar was being set up
        for (const { data, isBinary } of messageQueue) {
          sendDataToAgent(agentId, sessionId, data, isBinary);
        }
        messageQueue.length = 0;
      }

      browserSessions.set(`${sessionId}:ack`, onOpenPtyAck);

      sendCommand(agentId, { action: 'open_pty', sessionId, host, port, containerId, projectId });

      function cleanup() {
        sendCommand(agentId, { action: 'close_pty', sessionId });
        browserSessions.delete(sessionId);
        browserSessions.delete(`${sessionId}:ack`);
      }

      // ── browserWs 'close' (REMOTE path) ──────────────────────────────
      // TRIGGERED BY: Browser tab closed, user navigates away, or network drop.
      //
      // FLOW:
      //   Browser disconnects → cleanup()
      //     → sendCommand(agentId, {action:'close_pty', sessionId})
      //       → relay-agent receives 'close_pty' → calls sidecarWs.close()
      //         → sidecar ws 'close' fires → shell.kill() in editor-sidecar.js
      //     → browserSessions cleaned up
      //
      // PURPOSE: Tears down the full chain (BFF → relay-agent → sidecar → PTY)
      //          when the browser disconnects, preventing resource leaks.
      browserWs.on('close', cleanup);

      // ── browserWs 'error' (REMOTE path) ──────────────────────────────
      // TRIGGERED BY: WebSocket error on the browser connection (e.g. network fault).
      // PURPOSE: Same teardown as 'close'. Ensures cleanup even on abnormal disconnect.
      browserWs.on('error', cleanup);

      return;
    }

    // Local sidecar connection logic
    const sidecarUrl = `ws://${resolveSidecarHost(host)}:${port}`;
    const sidecarWs = new WebSocket(sidecarUrl);

    const pending = [];
    let sidecarReady = false;
    let pendingBytes = 0;
    const MAX_PENDING_BYTES = 50 * 1024;

    const connectTimer = setTimeout(() => {
      if (!sidecarReady) {
        sidecarWs.terminate();
        if (browserWs.readyState === WebSocket.OPEN) {
          browserWs.close(WS_CLOSE_SIDECAR_UNREACHABLE, 'Sidecar connection timeout');
        }
      }
    }, 10_000);

    // ── sidecarWs 'open' ───────────────────────────────────────────────
    // TRIGGERED BY: TCP connection to the sidecar's port 9999 succeeds.
    //   (This triggers editor-sidecar.js ptyWss 'connection' on the other end.)
    //
    // FLOW:
    //   BFF creates new WebSocket(container_ip:9999)
    //     → TCP handshake completes → this 'open' fires
    //     → flush all pending browser messages that arrived during connection setup
    //
    // PURPOSE: Marks the sidecar as ready and flushes any keystrokes the browser
    //          sent while the WS to the sidecar was still connecting.
    sidecarWs.on('open', () => {
      clearTimeout(connectTimer);
      sidecarReady = true;
      for (const { data, isBinary } of pending) {
        sidecarWs.send(data, { binary: isBinary });
      }
      pending.length = 0;
      pendingBytes = 0;
    });

    // ── sidecarWs 'error' ──────────────────────────────────────────────
    // TRIGGERED BY: Sidecar container is unreachable (not started, wrong IP, firewall).
    //
    // FLOW:
    //   Connection fails → sidecarWs.terminate()
    //     → browserWs.close(4503, 'Sidecar unreachable')
    //     → Browser terminal shows connection error.
    //
    // PURPOSE: Propagates sidecar connection failure to the browser with a
    //          meaningful close code (4503) so the UI can show an error state.
    sidecarWs.on('error', () => {
      clearTimeout(connectTimer);
      sidecarWs.terminate();
      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.close(WS_CLOSE_SIDECAR_UNREACHABLE, 'Sidecar unreachable');
      }
    });

    // ── sidecarWs 'close' ──────────────────────────────────────────────
    // TRIGGERED BY:
    //   - editor-sidecar.js shell.onExit → ws.close() (user typed `exit`)
    //   - Sidecar container stopped/crashed
    //
    // FLOW:
    //   Sidecar closes WS → this handler → browserWs.close(1000, 'Session ended')
    //   → Browser terminal shows "session ended"
    //
    // PURPOSE: Propagates clean sidecar shutdown to the browser.
    sidecarWs.on('close', () => {
      clearTimeout(connectTimer);
      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.close(1000, 'Session ended');
      }
    });

    // ── sidecarWs 'message' ────────────────────────────────────────────
    // TRIGGERED BY: editor-sidecar.js shell.onData → ws.send(binary)
    //   PTY produced output (command results, shell prompt, etc.)
    //
    // FLOW:
    //   PTY stdout → sidecar ws.send() → this handler → browserWs.send()
    //   → Browser xterm.js terminal.write() renders the output
    //
    // PURPOSE: Pipes raw PTY output from the sidecar to the browser terminal.
    sidecarWs.on('message', (data, isBinary) => {
      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(data, { binary: isBinary });
      }
    });

    // ── browserWs 'message' (LOCAL path) ───────────────────────────────
    // TRIGGERED BY: Browser xterm.js sends keystrokes (binary) or resize (text).
    //
    // FLOW:
    //   Browser keystroke → this handler
    //     → if sidecar not ready: queued in pending[] (with 50KB byte limit check)
    //     → if sidecar ready: sidecarWs.send() → editor-sidecar.js ws 'message'
    //       → shell.write() feeds keystroke into PTY
    //
    // PURPOSE: Forwards browser terminal input to the sidecar. Includes a 50KB
    //          pending buffer limit to prevent memory exhaustion if the sidecar
    //          takes too long to connect.
    browserWs.on('message', (data, isBinary) => {
      if (!sidecarReady) {
        const len = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data);
        if (pendingBytes + len > MAX_PENDING_BYTES) {
          browserWs.close(WS_CLOSE_SIDECAR_UNREACHABLE, 'Buffer overflow');
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

    // ── browserWs 'close' (LOCAL path) ─────────────────────────────────
    // TRIGGERED BY: Browser tab closed, user navigates away, or network drop.
    //
    // FLOW:
    //   Browser disconnects → sidecarWs.close()
    //     → editor-sidecar.js ws 'close' → shell.kill()
    //
    // PURPOSE: Tears down the sidecar connection and PTY when the browser leaves.
    browserWs.on('close', () => {
      clearTimeout(connectTimer);
      if (sidecarWs.readyState === WebSocket.OPEN || sidecarWs.readyState === WebSocket.CONNECTING) {
        sidecarWs.close();
      }
    });

    // ── browserWs 'error' (LOCAL path) ─────────────────────────────────
    // TRIGGERED BY: WebSocket error on the browser side.
    // PURPOSE: Forcefully terminates the sidecar connection on browser error.
    browserWs.on('error', () => {
      clearTimeout(connectTimer);
      sidecarWs.terminate();
    });
  });
}

module.exports = { attachPtyProxy };
