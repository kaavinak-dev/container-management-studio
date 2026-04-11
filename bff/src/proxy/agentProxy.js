const { WebSocketServer } = require('ws');
const { agents, browserSessions } = require('../services/agentRegistry');

const HEARTBEAT_INTERVAL = 30000; // 30 seconds

function attachAgentProxy(server) {
  const wss = new WebSocketServer({ noServer: true });

  const interval = setInterval(() => {
    agents.forEach((agent, agentId) => {
      if (agent.isAlive === false) {
        console.log(`[agent-proxy] Agent ${agentId} timed out. Terminating.`);
        agent.socket.terminate();
        agents.delete(agentId);
        return;
      }
      agent.isAlive = false;
      agent.socket.ping();
    });
  }, HEARTBEAT_INTERVAL);

  // ── wss 'close' ──────────────────────────────────────────────────────
  // TRIGGERED BY: The WebSocketServer itself is shut down (BFF process exit).
  // PURPOSE: Stops the heartbeat interval to prevent timer leaks on shutdown.
  wss.on('close', () => clearInterval(interval));

  // ── server 'upgrade' ─────────────────────────────────────────────────
  // TRIGGERED BY: relay-agent/index.js connect() opens
  //   `new WebSocket('ws://bff-host:3000/agents?agentId=...&hostname=...&os=...')`
  //
  // FLOW:
  //   relay-agent starts → registerWithBackend() → connect()
  //     → WebSocket upgrade request to /agents → this handler
  //     → handleUpgrade → emits 'connection'
  //
  // PURPOSE: Accepts WebSocket upgrades only on the /agents path.
  //          Other paths (like /proxy/:id) are handled by ptyProxy.
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/agents') return;

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  // ── wss 'connection' ─────────────────────────────────────────────────
  // TRIGGERED BY: server 'upgrade' above, after successful handleUpgrade.
  //
  // FLOW:
  //   relay-agent connects → registered in agents Map with metadata
  //     → welcome message sent back → relay-agent is now available for PTY routing
  //
  // PURPOSE: Registers the relay-agent in the agents Map so that ptyProxy
  //          (via agentRegistry.sendCommand) can send it 'open_pty'/'close_pty'
  //          commands and PTY data for remote sessions.
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const agentId = url.searchParams.get('agentId');
    const osType = url.searchParams.get('os') || 'unknown';
    const hostname = url.searchParams.get('hostname') || 'unknown';

    if (!agentId) {
      console.error('[agent-proxy] Connection rejected: agentId is missing');
      ws.close(4000, 'agentId query parameter required');
      return;
    }

    console.log(`[agent-proxy] Agent registered: ${agentId} (${osType} on ${hostname})`);
    
    const agentEntry = { 
      socket: ws, 
      connectedAt: new Date(),
      isAlive: true,
      metadata: { os: osType, hostname }
    };
    agents.set(agentId, agentEntry);

    // ── ws 'pong' ────────────────────────────────────────────────────────
    // TRIGGERED BY: relay-agent responds to a ping frame (sent by heartbeat interval
    //   every 30s above).
    //
    // FLOW:
    //   heartbeat interval sends ws.ping() every 30s
    //     → relay-agent's WS library auto-responds with pong
    //     → this handler sets isAlive = true
    //   Next heartbeat tick: if isAlive is still false → agent timed out → terminate
    //
    // PURPOSE: Dead-connection detection. If a relay-agent silently disappears
    //          (e.g. network partition), the heartbeat will detect it within 60s
    //          and remove it from the agents Map.
    ws.on('pong', () => {
      agentEntry.isAlive = true;
    });

    // ── ws 'message' ──────────────────────────────────────────────────────
    // TRIGGERED BY: relay-agent/index.js sends JSON messages back to BFF.
    //   Three message types arrive here:
    //
    //   A) {type:'data', sessionId, data, isBinary}
    //      TRIGGERED BY: relay-agent sidecarWs 'message' (index.js line ~169)
    //        Sidecar PTY output → relay-agent → this handler
    //      FLOW: → looks up browserWs in browserSessions → browserWs.send()
    //            → browser xterm.js renders the output
    //      PURPOSE: Last hop of the remote PTY output path. Routes sidecar output
    //               from the relay-agent to the correct browser terminal session.
    //
    //   B) {type:'ack', action:'open_pty', sessionId, success}
    //      TRIGGERED BY: relay-agent sidecarWs 'open' (index.js line ~157)
    //        Sidecar connection succeeded → relay-agent sends ack
    //      FLOW: → invokes onOpenPtyAck callback registered by ptyProxy.js (line ~72)
    //            → ptyProxy flips sidecarReady=true, flushes queued browser messages
    //      PURPOSE: Signals to ptyProxy that the full chain is ready. Without this,
    //               browser keystrokes would be queued indefinitely.
    //
    //   C) {type:'event', event:'sidecar_closed', sessionId}
    //      TRIGGERED BY: relay-agent sidecarWs 'close' (index.js line ~191)
    //        Sidecar disconnected (user typed `exit` or container stopped)
    //      FLOW: → looks up browserWs → browserWs.close(1000, 'Sidecar closed')
    //            → browser terminal shows session ended
    //      PURPOSE: Propagates sidecar shutdown through the relay path to the browser.
    ws.on('message', (rawData) => {
      try {
        const message = JSON.parse(rawData.toString());

        if (message.type === 'data') {
          const { sessionId, data, isBinary } = message;
          const browserWs = browserSessions.get(sessionId);
          if (browserWs && browserWs.readyState === 1) { // WebSocket.OPEN
            const payload = isBinary ? Buffer.from(data, 'base64') : data;
            browserWs.send(payload, { binary: isBinary });
          }
        }

        // When relay agent confirms sidecar is ready, invoke the ack handler registered
        // by ptyProxy so it can flush its queued browser messages.
        else if (message.type === 'ack' && message.action === 'open_pty') {
          const onOpenPtyAck = browserSessions.get(`${message.sessionId}:ack`);
          if (onOpenPtyAck) {
            onOpenPtyAck(message);
            browserSessions.delete(`${message.sessionId}:ack`);
          }
        }

        // Handle events (like sidecar closing)
        else if (message.type === 'event' && message.event === 'sidecar_closed') {
          const browserWs = browserSessions.get(message.sessionId);
          if (browserWs) {
            browserWs.close(1000, 'Sidecar closed');
            browserSessions.delete(message.sessionId);
          }
        }
      } catch (err) {
        // Ignore non-JSON or heartbeat messages
      }
    });

    // ── ws 'close' ────────────────────────────────────────────────────────
    // TRIGGERED BY: relay-agent disconnects (process restart, network drop,
    //   relay-agent/index.js ws 'close' or 'error' firing).
    //
    // FLOW:
    //   relay-agent disconnects → removed from agents Map
    //   Any in-flight remote PTY sessions via this agent become unreachable.
    //   (relay-agent will reconnect on its own via exponential backoff in connect())
    //
    // PURPOSE: Cleans up the agent registration so stale agents don't receive
    //          commands they can't handle.
    ws.on('close', () => {
      console.log(`[agent-proxy] Agent disconnected: ${agentId}`);
      agents.delete(agentId);
    });

    // ── ws 'error' ────────────────────────────────────────────────────────
    // TRIGGERED BY: WebSocket error on the agent connection.
    // PURPOSE: Same cleanup as 'close'. Logged for debugging connectivity issues.
    ws.on('error', (err) => {
      console.error(`[agent-proxy] Agent ${agentId} error:`, err.message);
      agents.delete(agentId);
    });

    ws.send(JSON.stringify({ type: 'welcome', agentId }));
  });
}

module.exports = { attachAgentProxy };
