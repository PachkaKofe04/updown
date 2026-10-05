import type WebSocket from 'ws';

/** Текст сообщения WebSocket при любом способе доставки: буфер, ArrayBuffer или фрагменты. */
export function rawDataToString(data: WebSocket.RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}
