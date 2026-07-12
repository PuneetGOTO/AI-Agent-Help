import type { NextConfig } from 'next';

const apiOrigin = (
  process.env.API_PROXY_URL ??
  process.env.API_URL ??
  'http://localhost:4000'
).replace(/\/$/, '');

const useStandalone = process.env.NEXT_STANDALONE === 'true' || process.platform !== 'win32';

const nextConfig: NextConfig = {
  ...(useStandalone ? { output: 'standalone' as const } : {}),
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiOrigin}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
