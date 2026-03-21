# container-management-studio

> **Browser-Based Development Studio for Containerized Projects**
>
> A BFF (Backend for Frontend) + React web app that lets users write, edit, and deploy
> Node.js projects to Docker containers — entirely from the browser.

---

## What This Project Does

This repo is the **browser layer** for the container management platform. It follows
the **Backend for Frontend (BFF)** pattern:

- **`bff/`** — Node.js/Express server. Handles PTY session management, WebSocket proxying,
  code editor file API (MinIO), and relaying deploy requests to the core `.NET` backend.
- **`web/`** — React app (Vite). Monaco editor, project manager, PTY terminal viewer.

The companion repo `container-management` (.NET/C#) handles the authoritative domain logic:
container lifecycle, virus scanning, Docker orchestration, and the upload pipeline.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Browser — React app (web/)                             │
│    Monaco editor + file tree + PTY terminal viewer      │
│                     │ REST + WebSocket                  │
└─────────────────────┼───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│  BFF — Node.js/Express (bff/)                           │
│    POST /sessions  → PTY session registry               │
│    WS   /proxy/:id → WebSocket ↔ container sidecar WS  │
│    GET/PUT /projects/:id/files/* → MinIO file API       │
│    POST /projects/:id/deploy → ZIP → /UploadJS          │
└─────────────────────┬───────────────────────────────────┘
                      │ REST
┌─────────────────────▼───────────────────────────────────┐
│  container-management (.NET — separate repo)            │
│    POST /UploadJS → virus scan → npm audit → Docker     │
└─────────────────────────────────────────────────────────┘
```

---

## Contract with container-management

### PTY sessions — container-management calls this BFF:

```http
POST /sessions
Content-Type: application/json

{
  "host": "172.17.0.5",
  "port": 8080,
  "label": "John's Container"
}
```

Response:
```json
{
  "sessionId": "abc123",
  "wsUrl": "wss://ec2-host/proxy/abc123"
}
```

### Deploy — BFF calls container-management:

```http
POST /UploadJS
Content-Type: multipart/form-data

files: <zip file>
```

---

## Dev Setup

```bash
# Install BFF dependencies
cd bff && npm install

# Start BFF (watches for changes)
npm run dev

# Start web app (in a separate terminal — proxies /sessions and /projects to BFF)
cd web && npm install && npm run dev
```

Or use root workspace scripts:
```bash
npm run dev:bff
npm run dev:web
```

---

## Project Structure

```
container-management-studio/
├── package.json                      # Root workspace coordinator
├── bff/                              # Node.js Backend for Frontend
│   ├── package.json
│   └── src/
│       ├── index.js                  # Express entry point
│       ├── routes/
│       │   ├── sessions.js           # PTY session management
│       │   └── projects.js           # Code editor file API (upcoming)
│       ├── proxy/
│       │   └── ptyProxy.js           # WebSocket ↔ sidecar WS bridge
│       ├── services/
│       │   ├── minioClient.js        # MinIO SDK wrapper (upcoming)
│       │   └── deployService.js      # ZIP + relay to /UploadJS (upcoming)
│       └── templates/
│           └── nodejs.js             # Node.js project template (upcoming)
└── web/                              # React app — Vite (upcoming)
    ├── package.json
    ├── vite.config.js                # Dev proxy → BFF
    └── src/
        ├── App.jsx
        └── components/
            ├── ProjectListPage.jsx
            ├── EditorPage.jsx        # Monaco editor + file tree
            └── DeployStatusModal.jsx
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Web app | React + Vite + Monaco Editor |
| BFF | Node.js + Express.js |
| WS Proxy | `ws` library |
| File storage | MinIO (`editor-projects` bucket) |
| Deploy target | container-management `.NET` backend (`/UploadJS`) |
