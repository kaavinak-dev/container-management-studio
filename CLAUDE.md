# container-management-studio — BFF + Web UI

## Rules for Claude

**Do NOT create a Pull Request under any circumstances unless the exact phrase `"Create PR"` (with double quotes) appears verbatim in the user's prompt.**
Opening a PR requires that explicit phrase and nothing else counts — paraphrases like "make a PR", "open a pull request", or "submit" do not qualify.

**Do NOT commit or push to any branch under any circumstances unless the exact phrase `"COMMIT"` (with double quotes) appears verbatim in the user's prompt.**
Paraphrases like "save", "push this", "ship it", or "update the branch" do not qualify.

---

## Purpose

This repo is the **Browser Layer** for the container management platform. It follows the **Backend for Frontend (BFF)** pattern:

- `bff/` — Node.js/Express server. Handles all browser-specific concerns: PTY session management, WebSocket proxying, code editor file API, and relay of deploy requests to the core backend.
- `web/` — React app (Vite). Talks exclusively to the BFF. Hosts the Monaco code editor, project manager, and PTY terminal viewer.

The two directories are owned and deployed together as one unit. Neither is independently meaningful without the other.

---

## Repo Architecture: Why Two Repos?

```
┌──────────────────────────────────────────────────┐
│  Repo: container-management  (.NET / C#)         │
│  Authoritative domain service:                   │
│    - Upload pipeline (virus scan, npm audit)     │
│    - Docker container lifecycle                  │
│    - gRPC sidecar (process diagnostics)          │
│    - PostgreSQL / MinIO / Hangfire               │
│  Deployed independently on its own schedule.     │
└──────────────────────────────────────────────────┘
                        ▲  REST APIs
┌──────────────────────────────────────────────────┐
│  THIS REPO: container-management-studio          │
│  BFF + Web UI layer:                             │
│                                                  │
│  bff/   ← Node.js BFF                            │
│    - PTY proxy  (/sessions + /proxy/:id)         │
│    - Code editor file API  (/projects/...)       │
│    - Deploy relay  (ZIP → /UploadJS)             │
│    - MinIO client  (editor-projects bucket)      │
│                                                  │
│  web/   ← React app                              │
│    - Monaco editor + file tree                   │
│    - Project list + deploy UI                    │
│    - PTY terminal viewer (xterm.js)              │
└──────────────────────────────────────────────────┘
```

The two repos are **not** merged into a monorepo because they have different tech stacks (.NET vs Node.js), different deployment cadences, and different conceptual ownership. This mirrors the pattern used at Spotify (`backend-services` repo + `web-player` repo).

---

## Directory Structure

```
container-management-studio/
├── CLAUDE.md                         ← this file
├── README.md
├── package.json                      ← root workspace coordinator
├── bff/                              ← Node.js Backend for Frontend
│   ├── package.json
│   └── src/
│       ├── index.js                  ← Express entry point
│       ├── routes/
│       │   ├── sessions.js           ← PTY session management
│       │   └── projects.js           ← Code editor file API (upcoming)
│       ├── proxy/
│       │   └── ptyProxy.js           ← WebSocket ↔ sidecar WS bridge
│       ├── services/
│       │   ├── minioClient.js        ← MinIO SDK wrapper (upcoming)
│       │   └── deployService.js      ← ZIP + POST to /UploadJS (upcoming)
│       └── templates/
│           └── nodejs.js             ← Node.js project template (upcoming)
└── web/                              ← React app (Vite) — to be scaffolded
    ├── package.json
    ├── vite.config.js                ← dev proxy: /projects/* /sessions/* → BFF
    └── src/
        ├── App.jsx
        └── components/
```

---

## BFF Routes

### PTY Sessions (existing)

| Method | Route | What it does |
|---|---|---|
| POST | `/sessions` | Store PTY connection details, return `{ sessionId, wsUrl }` |
| GET | `/sessions/:id` | Return session metadata |
| WS | `/proxy/:id` | Proxy browser WebSocket ↔ container sidecar WebSocket |

### Code Editor Projects (upcoming)

| Method | Route | What it does |
|---|---|---|
| POST | `/projects` | Create project from template, write files to MinIO |
| GET | `/projects` | List all projects |
| GET | `/projects/:id/files` | List file paths |
| GET | `/projects/:id/files/*` | Read file content |
| PUT | `/projects/:id/files/*` | Write file content |
| DELETE | `/projects/:id/files/*` | Delete a file |
| POST | `/projects/:id/deploy` | ZIP files → POST to container-management `/UploadJS` |

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

## Environment Variables (bff/)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | BFF listen port |
| `MINIO_ENDPOINT` | — | MinIO host |
| `MINIO_PORT` | `9000` | MinIO port |
| `MINIO_ACCESS_KEY` | — | MinIO access key |
| `MINIO_SECRET_KEY` | — | MinIO secret key |
| `EDITOR_BUCKET` | `editor-projects` | MinIO bucket for editor projects |
| `CONTAINER_MANAGEMENT_URL` | — | Base URL of the .NET backend (e.g. `http://192.168.99.101:5000`) |

---

## Dev Workflow

```bash
# Start BFF
cd bff && npm run dev

# Start web app (dev proxy forwards /sessions and /projects to BFF)
cd web && npm run dev

# Or via root scripts:
npm run dev:bff
npm run dev:web
```
