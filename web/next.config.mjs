/** @type {import('next').NextConfig} */
const BFF_URL = process.env.BFF_URL ?? 'http://localhost:3000'

const nextConfig = {
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
    ]
  },
}

export default nextConfig
