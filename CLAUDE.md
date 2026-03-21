# compute-instance-ui — Browser-Based Container Desktop Viewer

## Rules for Claude

**Do NOT create a Pull Request under any circumstances unless the exact phrase `"Create PR"` (with double quotes) appears verbatim in the user's prompt.**
Committing and pushing to a branch is fine at any time. Opening a PR requires that explicit phrase and nothing else counts — paraphrases like "make a PR", "open a pull request", or "submit" do not qualify.

---

## Purpose

Provides a browser UI that lets users interact with the XFCE desktop of their running Docker container — no client software required. Think "Royal TS, but web-first for Linux containers on EC2."

The `container-management` repo handles container lifecycle (create/scan/build/start). This repo handles the **visual GUI layer** on top of those containers.

## Current State

**Only a README exists.** No code has been written yet. This CLAUDE.md captures the architecture and contracts so implementation can proceed.

---

## Protocol Chain

```
Browser ↔ WebSocket (wss://) ↔ Node.js Proxy ↔ VNC TCP ↔ Container XFCE Desktop
```

- **noVNC** (JS library) renders VNC in a `<canvas>` element in the browser
- **Node.js backend** proxies WebSocket frames to raw VNC TCP using `ws` + `net` modules
- **No Apache Guacamole** or heavy gateway needed

---

## Architecture

```
Browser: React App (noVNC canvas)
         │  WebSocket wss://
Node.js Backend (Express)
  POST /sessions     → store VNC connection details, return sessionId + wsUrl
  GET  /sessions/:id → return session metadata
  WS   /proxy/:id   → proxy WS ↔ TCP VNC
         │  Raw TCP VNC
Docker Container (on EC2)
  TigerVNC on port 5900
  XFCE Desktop + Xvfb
```

---

## Contract with container-management

The `container-management` backend must call:

```http
POST /sessions
Content-Type: application/json

{
  "host": "172.17.0.5",       // Container's Docker bridge network IP
  "port": 5900,               // TigerVNC port (display :0)
  "password": "secret123",    // VNC password
  "label": "John's Container" // Optional display name
}
```

Response:
```json
{
  "sessionId": "abc123",
  "wsUrl": "wss://ec2-host/proxy/abc123"
}
```

User links:
- Standalone: `https://ec2-host/?sessionId=abc123`
- Embedded iframe: `https://ec2-host/?sessionId=abc123&embed=true`

---

## Planned Project Structure

```
compute-instance-ui/
├── backend/
│   ├── package.json
│   └── src/
│       ├── index.js                  # Express entry point
│       ├── routes/sessions.js        # POST /sessions, GET /sessions/:id
│       └── proxy/vncProxy.js         # WebSocket ↔ TCP VNC bridge
├── frontend/
│   ├── package.json
│   └── src/
│       ├── App.jsx
│       ├── main.jsx
│       └── components/
│           ├── VncViewer.jsx         # Wraps @novnc/novnc
│           └── SessionList.jsx       # Active sessions list
├── container-base/
│   ├── Dockerfile                    # Reference image for container-management to use
│   └── entrypoint.sh                # Starts Xvfb + XFCE + TigerVNC
├── nginx/
│   └── nginx.conf                    # TLS termination + WS upgrade headers
├── docker-compose.yml
└── README.md
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite + `@novnc/novnc` |
| Backend | Node.js + Express.js |
| WS Proxy | `ws` library + Node.js `net` module |
| Desktop (in container) | XFCE + TigerVNC on port 5900 |
| Reverse proxy | Nginx (TLS + WS upgrade) |
| Deployment | Docker Compose |

---

## Container Image Requirements

Every Docker container launched by `container-management` must include:

| Requirement | Recommended |
|---|---|
| Desktop environment | XFCE (lightweight) |
| VNC server | TigerVNC (`tigervnc-standalone-server`) |
| Virtual display | Xvfb (or built into VNC) |
| DBus session | `dbus-x11` |
| VNC password | Set via env var `VNC_PASSWORD` at start |

Ready-made option: `linuxserver/webtop:ubuntu-xfce` (pre-configured XFCE + KasmVNC, port 3000).

Custom Dockerfile base:
```dockerfile
FROM ubuntu:22.04
RUN apt-get install -y xfce4 tigervnc-standalone-server dbus-x11 xterm
```

---

## Implementation Phases

### Phase 1 — Node.js Backend
- `POST /sessions` stores `{ host, port, password, label }`, returns `{ sessionId, wsUrl }`
- `WS /proxy/:sessionId` bridges WS frames ↔ raw VNC TCP socket
- Cleans up TCP socket on WebSocket disconnect

### Phase 2 — React Frontend (noVNC)
- Reads `?sessionId=xxx` from URL
- Renders noVNC canvas full-window
- Toolbar: connection status, clipboard, fullscreen, disconnect
- `?embed=true` hides toolbar (for iframe use)

### Phase 3 — Docker Compose
- Backend + frontend + nginx in one `docker-compose.yml`
- Nginx: TLS termination + `Upgrade: websocket` headers

### Phase 4 — Reference Container Image
- `container-base/Dockerfile` for `container-management` to use as base
- `entrypoint.sh` starts Xvfb + XFCE + TigerVNC

---

## Security Notes

- VNC traffic is unencrypted by default — kept on Docker bridge network; browser uses WSS (TLS)
- VNC server must be running before the proxy connects — enforced by base image spec
- Docker bridge network allows EC2 host to reach container IPs directly (no port mapping needed)
- iframes: set `X-Frame-Options: SAMEORIGIN`; use `?embed=true` to hide toolbar

---

## Relationship to container-management Sidecar

The `container-management` sidecar (`os-process-manager-service`) runs on `:5000` (HTTP) and `:5001` (gRPC) inside the container for process diagnostics. The VNC server for this UI runs on `:5900`. These are separate services running concurrently inside the same container via `entrypoint.sh`.

If the `container-management` sidecar and the VNC desktop are both required in the same container, the `entrypoint.sh` from `container-management` needs to be extended to also start Xvfb + XFCE + TigerVNC — or the containers can be purpose-built as desktop containers that also embed the sidecar.
