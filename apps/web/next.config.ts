import type { NextConfig } from 'next';

const apiOrigin = process.env.API_ORIGIN ?? 'http://127.0.0.1:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Next.js не должен дописывать служебные файлы в репозиторий при `next dev`.
  agentRules: false,
  devIndicators: false,
  // Один origin для браузера: cookie сессии остаются first-party. В production это делает reverse proxy.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/:path*` }];
  },
};

export default nextConfig;
