const WebSocket = require('ws');
const os = require('os');
const Docker = require('dockerode');

const BFF_URL = process.env.BFF_URL || 'ws://localhost:3000/agents';
const AGENT_ID = process.env.AGENT_ID || `agent-${os.hostname()}-${Math.random().toString(36).substring(2, 5)}`;
const DOTNET_URL = process.env.DOTNET_URL || 'http://host.docker.internal:5235';
const DOCKER_HOST_TCP = 'http://localhost:2375';

// Dockerode connection for security validation (container inspect).
// Uses the mounted Unix socket (/var/run/docker.sock) — more reliable than TCP.
const docker = new Docker();

let retryCount = 0;
const MAX_RETRY_DELAY = 30000;

const REGISTER_MAX_RETRIES = 10;
const REGISTER_BASE_DELAY_MS = 2000;
const REGISTER_MAX_DELAY_MS = 30000;

const sidecarSessions = new Map(); // sessionId -> sidecarSocket

async function registerWithBackend() {
  for (let attempt = 1; attempt <= REGISTER_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${DOTNET_URL}/api/agents/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: AGENT_ID,
          dockerHost: DOCKER_HOST_TCP,
          hostname: os.hostname(),
        }),
      });

      if (res.ok) {
        console.log(`[relay-agent] Registered with backend as ${AGENT_ID} (dockerHost: ${DOCKER_HOST_TCP})`);
        return;
      }

      console.error(`[relay-agent] Backend registration failed (attempt ${attempt}/${REGISTER_MAX_RETRIES}): HTTP ${res.status}`);
    } catch (e) {
      console.error(`[relay-agent] Backend registration error (attempt ${attempt}/${REGISTER_MAX_RETRIES}): ${e.message}`);
    }

    if (attempt === REGISTER_MAX_RETRIES) {
      console.error('[relay-agent] Exhausted registration retries. Exiting so the container can be restarted.');
      process.exit(1);
    }

    const delay = Math.min(REGISTER_BASE_DELAY_MS * Math.pow(2, attempt - 1), REGISTER_MAX_DELAY_MS);
    console.log(`[relay-agent] Retrying registration in ${delay / 1000}s...`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

function connect() {
  const params = new URLSearchParams({ 
    agentId: AGENT_ID, 
    hostname: os.hostname(), 
    os: os.platform() 
  });
  const url = `${BFF_URL}?${params.toString()}`;
  console.log(`[relay-agent] Connecting to BFF: ${url}`);
  
  const ws = new WebSocket(url);

  // ── ws 'open' ──────────────────────────────────────────────────────────
  // TRIGGERED BY: TCP connection to BFF /agents WebSocket endpoint succeeds.
  //   (This triggers agentProxy.js server 'upgrade' → wss 'connection' on the BFF side.)
  //
  // FLOW:
  //   relay-agent starts → registerWithBackend() → connect()
  //     → WS handshake to BFF /agents completes → this 'open' fires
  //     → BFF sends {type:'welcome'} → agent is registered and ready
  //
  // PURPOSE: Confirms the control-plane connection to the BFF is established.
  //          Resets the retry counter so future disconnects start with short backoff.
  ws.on('open', () => {
    console.log(`[relay-agent] Connected to BFF as ${AGENT_ID}`);
    retryCount = 0;
  });

  // ── ws 'message' ────────────────────────────────────────────────────────
  // TRIGGERED BY: BFF agentProxy sends JSON messages to this relay-agent.
  //   Two message types arrive here:
  //
  //   A) {type:'command', action:'open_pty'|'close_pty', sessionId, host, port, ...}
  //      TRIGGERED BY: ptyProxy.js sendCommand() (line ~74 for open, line ~77 for close)
  //        via agentRegistry.sendCommand()
  //      FLOW: → handleCommand() dispatches based on action
  //        open_pty:  validates container ownership via Docker inspect
  //                   → opens WS to sidecar (container_ip:port)
  //                   → sends ack back to BFF
  //        close_pty: finds sidecar session → sidecarWs.close()
  //      PURPOSE: Control plane — BFF tells this agent to set up or tear down
  //               PTY connections to containers on this agent's Docker host.
  //
  //   B) {type:'data', sessionId, data, isBinary}
  //      TRIGGERED BY: ptyProxy.js browserWs 'message' (remote path, line ~50)
  //        → sendDataToAgent() in agentRegistry
  //        → agentProxy sends to this relay-agent
  //      FLOW: → looks up sidecarWs by sessionId → sidecarWs.send()
  //            → editor-sidecar.js ws 'message' → shell.write()
  //      PURPOSE: Data plane — forwards browser keystrokes to the correct sidecar PTY.
  ws.on('message', (rawData) => {
    try {
      const message = JSON.parse(rawData.toString());

      if (message.type === 'command') {
        handleCommand(ws, message);
      }
      else if (message.type === 'data') {
        const { sessionId, data: payload, isBinary } = message;
        const sidecarWs = sidecarSessions.get(sessionId);
        if (sidecarWs && sidecarWs.readyState === 1) {
          const dataToSidecar = isBinary ? Buffer.from(payload, 'base64') : payload;
          sidecarWs.send(dataToSidecar, { binary: isBinary });
        }
      }
    } catch (err) { }
  });

  // ── ws 'close' ──────────────────────────────────────────────────────────
  // TRIGGERED BY: BFF restarts, network interruption, or BFF terminates the connection
  //   (e.g. heartbeat timeout in agentProxy.js).
  //
  // FLOW:
  //   BFF connection lost → all sidecar sessions terminated and cleared
  //     → exponential backoff retry (1s → 2s → 4s → ... → 30s max)
  //     → reconnect() → re-registers with BFF
  //   On BFF side: agentProxy ws 'close' fires → agent removed from agents Map
  //
  // PURPOSE: Gracefully handles BFF disconnection. Cleans up all active sidecar
  //          sessions (they're useless without the BFF bridge) and reconnects.
  ws.on('close', () => {
    sidecarSessions.forEach(s => s.terminate());
    sidecarSessions.clear();
    
    retryCount++;
    const delay = Math.min(1000 * Math.pow(2, retryCount), MAX_RETRY_DELAY);
    console.log(`[relay-agent] Connection lost. Retrying in ${delay/1000}s...`);
    setTimeout(connect, delay);
  });

  // ── ws 'error' ──────────────────────────────────────────────────────────
  // TRIGGERED BY: WebSocket connection error (BFF unreachable, DNS failure, etc.)
  // PURPOSE: Terminates the socket so 'close' fires and triggers reconnection.
  ws.on('error', (err) => {
    console.error('[relay-agent] Connection error:', err.message);
    ws.terminate();
  });
}

/**
 * Handles control plane commands like opening/closing PTY connections.
 */
async function handleCommand(bffWs, cmd) {
  const { action, sessionId, host, port, containerId, projectId } = cmd;

  if (action === 'open_pty') {
    // 1. Security Check: Verify container belongs to project
    try {
      if (containerId && projectId) {
        console.log(`[relay-agent] [${sessionId}] Validating container ${containerId} for project ${projectId}`);
        const container = docker.getContainer(containerId);
        const data = await container.inspect();
        
        // Check for the com.manager.projectid label
        const containerProjectId = data.Config.Labels['com.manager.projectid'];
        
        if (containerProjectId !== projectId) {
          console.error(`[relay-agent] [${sessionId}] Security mismatch! Container ${containerId} project (${containerProjectId}) does not match request (${projectId})`);
          bffWs.send(JSON.stringify({
            type: 'ack',
            action: 'open_pty',
            sessionId,
            success: false,
            error: 'Security validation failed: Project ID mismatch'
          }));
          return;
        }
        console.log(`[relay-agent] [${sessionId}] Security check passed`);
      } else {
        console.warn(`[relay-agent] [${sessionId}] Skipping security check (missing containerId/projectId in command)`);
      }
    } catch (err) {
      console.error(`[relay-agent] [${sessionId}] Docker validation error:`, err.message);
      bffWs.send(JSON.stringify({
        type: 'ack',
        action: 'open_pty',
        sessionId,
        success: false,
        error: `Container not found or Docker error: ${err.message}`
      }));
      return;
    }

    // 2. Proceed with connection if validated
    const sidecarUrl = `ws://${host}:${port}`;
    console.log(`[relay-agent] [${sessionId}] Opening PTY to ${sidecarUrl}`);

    const sidecarWs = new WebSocket(sidecarUrl);

    // ── sidecarWs 'open' ───────────────────────────────────────────────
    // TRIGGERED BY: TCP connection to the sidecar container's port 9999 succeeds.
    //   (This triggers editor-sidecar.js ptyWss 'connection' on the container side.)
    //
    // FLOW:
    //   relay-agent receives 'open_pty' command → Docker security validation passes
    //     → new WebSocket(container_ip:port) → TCP handshake completes → this fires
    //     → session stored in sidecarSessions Map
    //     → sends {type:'ack', action:'open_pty', success:true} back to BFF
    //       → agentProxy.js ws 'message' routes ack to ptyProxy onOpenPtyAck callback
    //       → ptyProxy flips sidecarReady, flushes queued browser keystrokes
    //
    // PURPOSE: Confirms the sidecar PTY is reachable and ready. The ack message
    //          is the signal that unblocks browser input in the remote path.
    sidecarWs.on('open', () => {
      console.log(`[relay-agent] [${sessionId}] Sidecar connection established`);
      sidecarSessions.set(sessionId, sidecarWs);
      
      bffWs.send(JSON.stringify({
        type: 'ack',
        action: 'open_pty',
        sessionId,
        success: true
      }));
    });

    // ── sidecarWs 'message' ────────────────────────────────────────────
    // TRIGGERED BY: editor-sidecar.js shell.onData → ws.send(binary)
    //   PTY produced output (command results, shell prompt, etc.)
    //
    // FLOW:
    //   PTY stdout → sidecar ws.send() → this handler
    //     → wraps as {type:'data', sessionId, data (base64 if binary), isBinary}
    //     → bffWs.send() to BFF
    //     → agentProxy.js ws 'message' handler (type:'data' branch)
    //     → browserSessions.get(sessionId) → browserWs.send()
    //     → browser xterm.js terminal.write() renders output
    //
    // PURPOSE: Relays PTY output from the sidecar through the BFF to the browser.
    //          Binary data is base64-encoded for safe JSON transport.
    sidecarWs.on('message', (data, isBinary) => {
      if (bffWs.readyState === 1) {
        bffWs.send(JSON.stringify({
          type: 'data',
          sessionId,
          data: isBinary ? data.toString('base64') : data.toString(),
          isBinary
        }));
      }
    });

    // ── sidecarWs 'error' ──────────────────────────────────────────────
    // TRIGGERED BY: Sidecar container unreachable or connection reset.
    //
    // FLOW:
    //   Connection to sidecar fails → sends {type:'ack', action:'open_pty', success:false}
    //     → agentProxy.js routes to ptyProxy onOpenPtyAck
    //     → ptyProxy closes browserWs with 4503
    //     → browser shows connection error
    //
    // PURPOSE: Reports sidecar connection failure back through the chain so the
    //          browser gets a meaningful error instead of hanging indefinitely.
    sidecarWs.on('error', (err) => {
      console.error(`[relay-agent] [${sessionId}] Sidecar error:`, err.message);
      bffWs.send(JSON.stringify({
        type: 'ack',
        action: 'open_pty',
        sessionId,
        success: false,
        error: err.message
      }));
    });

    // ── sidecarWs 'close' ──────────────────────────────────────────────
    // TRIGGERED BY:
    //   - editor-sidecar.js shell.onExit → ws.close() (user typed `exit`)
    //   - Sidecar container stopped/crashed
    //   - This relay-agent's 'close_pty' command called sidecarWs.close()
    //
    // FLOW:
    //   Sidecar closes → session removed from sidecarSessions Map
    //     → sends {type:'event', event:'sidecar_closed', sessionId} to BFF
    //     → agentProxy.js ws 'message' handler (type:'event' branch)
    //     → browserWs.close(1000, 'Sidecar closed')
    //     → browser terminal shows session ended
    //
    // PURPOSE: Propagates sidecar shutdown through the relay chain to the browser
    //          and cleans up the local session tracking.
    sidecarWs.on('close', () => {
      console.log(`[relay-agent] [${sessionId}] Sidecar connection closed`);
      sidecarSessions.delete(sessionId);
      
      if (bffWs.readyState === 1) {
        bffWs.send(JSON.stringify({
          type: 'event',
          event: 'sidecar_closed',
          sessionId
        }));
      }
    });
  } 
  
  else if (action === 'close_pty') {
    const session = sidecarSessions.get(sessionId);
    if (session) {
      console.log(`[relay-agent] [${sessionId}] Closing PTY by request`);
      session.close();
      sidecarSessions.delete(sessionId);
    }
  }
}

registerWithBackend().then(() => connect());
