const agents = new Map(); // agentId -> { socket, connectedAt, isAlive, metadata }
const browserSessions = new Map(); // sessionId -> browserWs

/**
 * Sends a structured command to a specific agent.
 * @param {string} agentId 
 * @param {object} command { action, sessionId, host, port }
 */
function sendCommand(agentId, command) {
  const agent = agents.get(agentId);
  if (agent && agent.socket.readyState === 1) { // WebSocket.OPEN
    agent.socket.send(JSON.stringify({ 
      type: 'command', 
      ...command 
    }));
    return true;
  }
  return false;
}

/**
 * Sends raw PTY data to a specific agent, wrapped in a session envelope.
 * @param {string} agentId
 * @param {string} sessionId
 * @param {Buffer|string} data
 * @param {boolean} isBinary
 */
function sendDataToAgent(agentId, sessionId, data, isBinary) {
  const agent = agents.get(agentId);
  if (agent && agent.socket.readyState === 1) {
    agent.socket.send(JSON.stringify({
      type: 'data',
      sessionId,
      data: isBinary ? data.toString('base64') : data.toString(),
      isBinary
    }));
    return true;
  }
  return false;
}

module.exports = { agents, browserSessions, sendCommand, sendDataToAgent };
