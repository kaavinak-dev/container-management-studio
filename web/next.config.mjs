/** @type {import('next').NextConfig} */
const BFF_URL = process.env.BFF_URL ?? 'http://localhost:3000'

const nextConfig = {
  reactStrictMode:false,
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      // REST: sessions
      { source: '/sessions',     destination: `${BFF_URL}/sessions` },
      { source: '/sessions/:id', destination: `${BFF_URL}/sessions/:id` },

      // REST: projects + files
      { source: '/projects',                          destination: `${BFF_URL}/projects` },
      { source: '/projects/:id',                      destination: `${BFF_URL}/projects/:id` },
      { source: '/projects/:id/deploy',               destination: `${BFF_URL}/projects/:id/deploy` },
      { source: '/projects/:id/files',                destination: `${BFF_URL}/projects/:id/files` },
      { source: '/projects/:id/files/:path*',         destination: `${BFF_URL}/projects/:id/files/:path*` },

      // REST: deployments (includes SSE /stream route)
      { source: '/deployments/:id/steps',             destination: `${BFF_URL}/deployments/:id/steps` },
      { source: '/deployments/:id/steps/stream',      destination: `${BFF_URL}/deployments/:id/steps/stream` },

      // REST: editor sessions + heartbeat + terminal
      { source: '/editor-sessions',                          destination: `${BFF_URL}/editor-sessions` },
      { source: '/editor-sessions/:projectId/heartbeat',     destination: `${BFF_URL}/editor-sessions/:projectId/heartbeat` },
      { source: '/editor-sessions/:projectId/terminal',      destination: `${BFF_URL}/editor-sessions/:projectId/terminal` },

      // REST: resources
      { source: '/resources',                          destination: `${BFF_URL}/resources` },
      { source: '/resources/catalog/all',              destination: `${BFF_URL}/resources/catalog/all` },
      { source: '/resources/:projectId',               destination: `${BFF_URL}/resources/:projectId` },
      { source: '/resources/:projectId/:resourceId',    destination: `${BFF_URL}/resources/:projectId/:resourceId` },
    ]
  },
}

export default nextConfig
