/**
 * Next.js configuration for MediaHub web.
 *
 * Static export is enabled so the output is pure HTML/CSS/JS that can be served
 * by the Go backend (or any static host) without a Node.js runtime.
 *
 * `trailingSlash: true` keeps URLs file-based (e.g. /folder/ → folder.html)
 * which matches how the Go server used to serve *.html pages.
 *
 * The build output is directed to ./out and a post-build script (scripts/copy-to-public.js)
 * copies it into ../public so the existing Go server (which serves ./public) can
 * pick up the new frontend without any change to server.go.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    // Static export does not support Next/Image optimization. Disable it.
    unoptimized: true,
  },
  reactStrictMode: true,
  // Web Components (custom elements) used by @material/web are client-only.
  // Ensure they're not transpiled in a way that breaks their registration.
  experimental: {
    esmExternals: 'loose',
  },
};

module.exports = nextConfig;