import { networkInterfaces } from 'node:os';
import type { NextConfig } from 'next';

const apiOrigin = process.env.API_ORIGIN ?? 'http://127.0.0.1:4000';

// dev: сайт можно открыть с телефона по адресу этого компьютера в локальной сети
const lanAddresses = Object.values(networkInterfaces())
  .flatMap((list) => list ?? [])
  .filter((a) => a.family === 'IPv4' && !a.internal)
  .map((a) => a.address);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Next.js не должен дописывать служебные файлы в репозиторий при `next dev`.
  agentRules: false,
  devIndicators: false,
  allowedDevOrigins: lanAddresses,
  // Один origin для браузера: cookie сессии остаются first-party. В production это делает reverse proxy.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/:path*` }];
  },
};

export default nextConfig;
