import type { NextConfig } from 'next';

/**
 * IMPORTANT: rewrites run on the Next.js server.
 * Use API_ORIGIN for server-to-server proxying.
 * In production, do NOT default to localhost; require explicit configuration.
 */
const apiOriginRaw = process.env.API_ORIGIN || process.env.NEXT_PUBLIC_API_URL || '';
const apiOrigin = (apiOriginRaw || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:4000')).replace(/\/$/, '');
const isProduction = process.env.NODE_ENV === 'production';

if (!apiOrigin) {
  throw new Error('Missing API_ORIGIN. Set API_ORIGIN to your API base URL (e.g. https://api.nolsaf.com).');
}
const socketOrigin = (process.env.NEXT_PUBLIC_SOCKET_URL || '').replace(/\/$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep the local NRMS shell unobstructed; production never shows this badge.
  devIndicators: false,
  // Generated maps are immediately moved out of public static assets by the
  // post-build collector and retained as private diagnostics artifacts.
  productionBrowserSourceMaps: true,
  transpilePackages: ['@nolsaf/shared'],
  // 'standalone' is required for Docker/Railway deployments.
  // Vercel (process.env.VERCEL) handles its own output format — standalone breaks it.
  output: process.env.VERCEL ? undefined : 'standalone',
  experimental: {
    // Allow larger proxied bodies for draft property submissions in development.
    // Without this, Next will truncate bodies >10MB when proxying /api/*.
    proxyClientMaxBodySize: '25mb',
  },
  webpack: (config, { dev }) => {
    if (dev) {
      // Disable persistent filesystem pack cache in dev on Windows.
      // This avoids intermittent ENOENT stat/rename errors for *.pack.gz files.
      config.cache = false;

      // Polling avoids missed FS events on some Windows environments.
      config.watchOptions = {
        ...(config.watchOptions || {}),
        poll: 1000,
        aggregateTimeout: 300,
        ignored: ['**/node_modules/**', '**/.git/**', '**/.next/**'],
      };
    }
    return config;
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'img.youtube.com', pathname: '/**' },
      { protocol: 'https', hostname: 'res.cloudinary.com', pathname: '/**' },
      { protocol: 'https', hostname: 'api.mapbox.com', pathname: '/**' },
      { protocol: 'https', hostname: '*.mapbox.com', pathname: '/**' },
      ...(isProduction ? [] : [
        { protocol: 'http' as const, hostname: 'localhost', pathname: '/**' },
        { protocol: 'http' as const, hostname: '127.0.0.1', pathname: '/**' },
      ]),
    ],
  },
  turbopack: {},
  async headers() {
    const localConnectSrc = isProduction ? [] : [
      'http://127.0.0.1:4000',
      'http://localhost:4000',
      'http://localhost:3001',
      'ws:',
    ];
    const connectSrc = [
      "'self'",
      'https:',
      'wss:',
      'https://api.mapbox.com',
      'https://events.mapbox.com',
      apiOrigin,
      socketOrigin,
      ...localConnectSrc,
    ].filter(Boolean);
    const scriptSrc = [
      "'self'",
      ...(isProduction ? [] : ["'unsafe-eval'"]),
      "'unsafe-inline'",
      'https://static.cloudflareinsights.com',
      'https://api.mapbox.com',
      'https://events.mapbox.com',
    ].join(' ');
    const imgSrc = [
      "'self'",
      'blob:',
      'data:',
      'https:',
      ...(isProduction ? [] : ['http:']),
      'res.cloudinary.com',
      'img.youtube.com',
      'https://api.mapbox.com',
      'https://*.mapbox.com',
    ].join(' ');
    const frameSrc = [
      "'self'",
      'https://js.stripe.com',
      'https://hooks.stripe.com',
    ].join(' ');

    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline' https://api.mapbox.com; img-src ${imgSrc}; font-src 'self' data:; worker-src 'self' blob:; media-src 'self' blob: data: https:; connect-src ${connectSrc.join(' ')}; frame-ancestors 'self'; frame-src ${frameSrc};`,
          },
        ],
      },
    ];
  },
  async rewrites() {
    return {
      // beforeFiles: rewrites run before filesystem/page checks.
      // Use for rewrites that must always apply (uploads, webhooks, API proxies, socket.io).
      beforeFiles: [
        // Favicon/app-icon compatibility: Next metadata routes here are `/icon` and `/apple-icon`.
        // Many browsers still request `/favicon.ico` and some tooling uses `/icon.png`.
        { source: '/favicon.ico', destination: '/icon' },
        { source: '/apple-touch-icon.png', destination: '/apple-icon' },
        { source: '/icon.png', destination: '/icon' },
        { source: '/apple-icon.png', destination: '/apple-icon' },

        // Map health probes (API exposes these at the root, not under /api)
        { source: '/api/health', destination: `${apiOrigin}/health` },
        { source: '/api/ready', destination: `${apiOrigin}/ready` },
        { source: '/api/live', destination: `${apiOrigin}/live` },

        // Next.js 15/16 built-in client-error reporting — must NOT be proxied to Express.
        // These requests are handled internally by the Next.js server.
        // Listing them here before the catch-all ensures they pass through to the Next.js handler.
        { source: '/api/client-errors', destination: '/api/client-errors' },
        { source: '/api/client-errors/:path*', destination: '/api/client-errors/:path*' },

        { source: '/api/:path*', destination: `${apiOrigin}/api/:path*` },

        { source: '/uploads/:path*', destination: `${apiOrigin}/uploads/:path*` },
        { source: '/webhooks/:path*', destination: `${apiOrigin}/webhooks/:path*` },
        // Explicit socket.io rewrites to ensure both base and nested paths proxy
        { source: '/socket.io', destination: `${apiOrigin}/socket.io/` },
        { source: '/socket.io/', destination: `${apiOrigin}/socket.io/` },
        { source: '/socket.io/:path*', destination: `${apiOrigin}/socket.io/:path*` },
      ],

      // afterFiles: rewrites run AFTER Next.js pages/filesystem checks.
      // This ensures Next.js pages (e.g. /admin/owners/[id], /admin/users/[id]) are served
      // by the Next.js router first, and only fall through to the API proxy if no page is found.
      // This prevents the catch-all proxy from accidentally swallowing RSC navigation requests
      // for page routes that exist in the Next.js app.
      afterFiles: [
        {
          // Proxy legacy /admin/* routes to the API backend.
          // IMPORTANT: This runs AFTER Next.js pages, so Next.js admin pages always win.
          // The exclusion list is kept for safety but the afterFiles ordering is the main guard.
          source:
            '/admin/:path((?!cancellations/tours/\\d+|cancellations/\\d+|bookings/\\d+|owners/\\d+|properties/\\d+|revenue/\\d+|users/\\d+|agents/\\d+|agents/tour-revenue/\\d+|management/.*|drivers/audit/.*|drivers/invoices/review(?:/.*)?$|profile$|profile/).*)',
          // NOTE: removed trailing $ anchors so RSC sub-paths like /owners/3.segments/... are also excluded
          destination: `${apiOrigin}/admin/:path*`,
        },
        // NOTE: /owner/* proxy removed — all owner API calls use /api/owner/...
        // (proxied via the beforeFiles /api/:path* rule). The /owner/* URL namespace
        // is reserved entirely for Next.js pages so no catch-all proxy is needed here.
      ],

      fallback: [],
    };
  },
};

export default nextConfig;
