# compute-instance-ui

> **Docker Container GUI Viewer Plugin**
>
> A browser-based graphical desktop viewer for Docker containers — think Royal TS,
> but web-first and for Linux containers on EC2.

---

## What This Project Does

Users can view and interact with the desktop GUI of a running Docker container
directly in their browser — no client software required. This project is a
**plugin/companion** to a container management system (separate repo). That project
handles container lifecycle (create/start/stop/delete); this one handles the
visual GUI layer.

---

## Feasibility

**Yes — this is feasible.** The core protocol chain is:

```
Browser ↔ WebSocket (WSS) ↔ Node.js Proxy ↔ VNC TCP ↔ Container Desktop
```

- **noVNC** (open-source JS library) renders a VNC session in a `<canvas>` in the browser
- A lightweight Node.js backend proxies WebSocket connections to raw VNC TCP
- No heavy gateway (like Apache Guacamole) needed for this scope

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Browser                               │
│  ┌─────────────────────────────────────────────────┐    │
│  │  React App (noVNC canvas)                       │    │
│  │  - Full screen desktop view                     │    │
│  │  - Keyboard/mouse forwarding                    │    │
│  │  - Clipboard sync                               │    │
│  │  - Embeddable as <iframe> or Web Component      │    │
│  └──────────────────┬──────────────────────────────┘    │
│                     │ WebSocket (wss://)                 │
└─────────────────────┼───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│              Node.js Backend (EC2)                       │
│  POST /sessions → creates a proxied WS endpoint         │
│  GET  /sessions/:id → returns session metadata           │
│  WebSocket /proxy/:sessionId → proxies to VNC TCP        │
│                                                          │
│  Uses: ws (WebSocket) + net (TCP) for proxying           │
│  Framework: Express.js                                   │
└─────────────────────┬───────────────────────────────────┘
                      │ Raw TCP VNC protocol
┌─────────────────────▼───────────────────────────────────┐
│           Docker Container (EC2)                         │
│  VNC Server (TigerVNC) on port 5900                     │
│  XFCE Desktop Environment                               │
│  Xvfb virtual display                                   │
└─────────────────────────────────────────────────────────┘
```

---

## Contract: What the Other Project Must Provide

To connect a container to this viewer, the container management project must call:

```http
POST /sessions
Content-Type: application/json

{
  "host": "172.17.0.5",       // Container's Docker network IP
  "port": 5900,                // VNC port (TigerVNC default for display :0)
  "password": "secret123",     // VNC password set at container start
  "label": "John's Container"  // Optional: friendly display name
}
```

Response:
```json
{
  "sessionId": "abc123",
  "wsUrl": "wss://ec2-host/proxy/abc123"
}
```

Use the `sessionId` to link users to:
- Standalone view: `https://ec2-host/?sessionId=abc123`
- Embedded iframe: `https://ec2-host/?sessionId=abc123&embed=true`

---

## Container Base Image Requirements

For this plugin to connect, each Docker container **must** include:

| Requirement | Recommended |
|-------------|-------------|
| Desktop environment | XFCE (lightweight) |
| VNC server | TigerVNC (`tigervnc-standalone-server`) |
| Virtual display | Xvfb (or built into VNC server) |
| DBus session | `dbus-x11` |
| VNC password | Set via env var `VNC_PASSWORD` at container start |

**Easiest option — use a ready-made image:**

```yaml
image: linuxserver/webtop:ubuntu-xfce
environment:
  - PASSWORD=your_vnc_password
```

This image is pre-configured with XFCE + KasmVNC, exposes port `3000` (noVNC built-in).

**Or build a custom image** from `ubuntu:22.04`:
```dockerfile
RUN apt-get install -y xfce4 tigervnc-standalone-server dbus-x11 xterm
```

---

## Blockers & Risks

### Critical

| Risk | Mitigation |
|------|-----------|
| VNC is unencrypted by default | Proxy stays on private Docker bridge network; browser uses WSS (TLS) |
| VNC server must be running at container start | Enforce base image spec above |

### Significant

| Risk | Mitigation |
|------|-----------|
| Container IP must be reachable from EC2 host | Use Docker bridge network (host can reach container IPs directly without port mapping) |
| Session cleanup on disconnect | Backend closes TCP socket when WebSocket disconnects |
| iframe embedding blocked by CSP | Set `X-Frame-Options: SAMEORIGIN`; use `?embed=true` param to hide toolbar |

### Minor

- VNC has slightly higher latency than RDP — acceptable for desktop apps, not for video
- Single display per container (VNC limitation) — fine for this use case

---

## Planned Project Structure

```
compute-instance-ui/
├── backend/
│   ├── package.json
│   └── src/
│       ├── index.js                  # Express app entry point
│       ├── routes/sessions.js        # POST /sessions, GET /sessions/:id
│       └── proxy/vncProxy.js         # WebSocket ↔ TCP VNC bridge
├── frontend/
│   ├── package.json
│   └── src/
│       ├── App.jsx
│       ├── main.jsx
│       └── components/
│           ├── VncViewer.jsx         # Wraps @novnc/novnc
│           └── SessionList.jsx       # List of active sessions
├── container-base/
│   ├── Dockerfile                    # Reference image for the other project
│   └── entrypoint.sh                 # Starts Xvfb + XFCE + TigerVNC
├── nginx/
│   └── nginx.conf                    # Reverse proxy + TLS + WS upgrade headers
├── docker-compose.yml                # Runs backend + frontend + nginx
└── README.md
```

---

## Implementation Phases

### Phase 1 — Node.js Backend
- `POST /sessions` stores connection details, returns `sessionId`
- WebSocket route `/proxy/:sessionId` bridges WS frames ↔ raw TCP VNC socket
- Cleans up TCP connections on browser disconnect

### Phase 2 — React Frontend (noVNC)
- Accepts `?sessionId=xxx` query param
- Renders noVNC canvas full-window
- Toolbar: connection status, clipboard, fullscreen, disconnect
- `?embed=true` hides toolbar for iframe embedding

### Phase 3 — Docker Compose Deployment
- Backend + frontend + nginx in a single `docker-compose.yml`
- Nginx handles TLS termination and WebSocket upgrade headers

### Phase 4 — Reference Container Image
- `container-base/Dockerfile` for the other project to use as a base
- `entrypoint.sh` that starts the full desktop + VNC stack

---

## Verification Plan

1. **Unit** — Backend returns a valid session ID for a `POST /sessions` request
2. **Integration** — Connect a local VNC server and verify the WS proxy bridges correctly
3. **E2E** — Spin up `linuxserver/webtop`, POST its IP:port to backend, open frontend, see XFCE desktop in browser
4. **Embed test** — Load frontend in an `<iframe>`, verify no X-Frame-Options errors
5. **Disconnect test** — Close browser tab, verify TCP socket closes on the EC2 host

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite + `@novnc/novnc` |
| Backend | Node.js + Express.js |
| WS Proxy | `ws` library + Node.js `net` module |
| Desktop | XFCE + TigerVNC (inside container) |
| Reverse proxy | Nginx (TLS + WS upgrade) |
| Deployment | Docker Compose |
| EC2 OS | Ubuntu 22.04 |
