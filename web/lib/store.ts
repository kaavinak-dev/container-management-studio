"use client"

export type ProjectStatus = "draft" | "deploying" | "approved" | "quarantined" | "rejected"
export type ProjectType = "nodejs"
export type BaseOS = "ubuntu" | "alpine"

export interface ProjectFile {
  name: string
  content: string
  language: "javascript" | "json" | "text"
}

export interface Project {
  id: string
  name: string
  type: ProjectType
  status: ProjectStatus
  createdAt: Date
  files: ProjectFile[]
  nodeVersion: string
  baseOS: BaseOS
  riskScore?: number
  issues?: string[]
}

export const MOCK_PROJECTS: Project[] = [
  {
    id: "proj-1",
    name: "api-gateway-service",
    type: "nodejs",
    status: "approved",
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    nodeVersion: "20",
    baseOS: "ubuntu",
    riskScore: 12,
    files: [
      {
        name: "index.js",
        language: "javascript",
        content: `const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'API Gateway running', version: '1.0.0' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', uptime: process.uptime() });
});

app.listen(PORT, () => {
  console.log(\`API Gateway listening on port \${PORT}\`);
});
`,
      },
      {
        name: "package.json",
        language: "json",
        content: `{
  "name": "api-gateway-service",
  "version": "1.0.0",
  "description": "API Gateway microservice",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "dev": "nodemon index.js"
  },
  "dependencies": {
    "express": "^4.18.2"
  }
}
`,
      },
    ],
  },
  {
    id: "proj-2",
    name: "worker-queue-processor",
    type: "nodejs",
    status: "deploying",
    createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    nodeVersion: "18",
    baseOS: "alpine",
    files: [
      {
        name: "index.js",
        language: "javascript",
        content: `const { Queue } = require('bullmq');
const redis = { host: process.env.REDIS_HOST, port: 6379 };

const queue = new Queue('jobs', { connection: redis });

async function processJobs() {
  console.log('Worker queue processor starting...');
  // Process jobs from queue
  setInterval(async () => {
    const count = await queue.count();
    console.log(\`Queue depth: \${count} jobs\`);
  }, 5000);
}

processJobs().catch(console.error);
`,
      },
      {
        name: "package.json",
        language: "json",
        content: `{
  "name": "worker-queue-processor",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "bullmq": "^4.12.0"
  }
}
`,
      },
    ],
  },
  {
    id: "proj-3",
    name: "my-new-app",
    type: "nodejs",
    status: "draft",
    createdAt: new Date(Date.now() - 5 * 60 * 1000),
    nodeVersion: "20",
    baseOS: "ubuntu",
    files: [
      {
        name: "index.js",
        language: "javascript",
        content: `// Simple Node App
const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Hello World!\\n');
});

server.listen(3000, () => {
  console.log('Simple Node App listening on port 3000');
});
`,
      },
      {
        name: "package.json",
        language: "json",
        content: `{
  "name": "my-new-app",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {}
}
`,
      },
    ],
  },
]

export function getRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSecs < 60) return "just now"
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`
  return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`
}

export function generateId(): string {
  return "proj-" + Math.random().toString(36).substr(2, 9)
}
