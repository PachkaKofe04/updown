import { networkInterfaces } from 'node:os';

/** IPv4-адреса этого компьютера в локальной сети (без loopback): по ним сайт открывают с телефона. */
export function lanAddresses(): Set<string> {
  const out = new Set<string>();
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.add(a.address);
  }
  return out;
}
