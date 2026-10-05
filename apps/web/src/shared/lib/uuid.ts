/**
 * UUID v4 для ключей идемпотентности. crypto.randomUUID есть только в защищённом контексте
 * (HTTPS или localhost), а getRandomValues - везде: прогноз открывается и по адресу в локальной сети.
 */
export function uuid(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40; // версия 4
  b[8] = (b[8]! & 0x3f) | 0x80; // вариант RFC 4122
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
