import type { ClientEvent, ClientEventName } from '@updown/contracts';
import { serverNow } from './server-clock';
import { uuid } from './uuid';

// События продукта копятся пачкой и уходят раз в несколько секунд; при закрытии вкладки - сразу.
// Ошибка отправки не мешает игре: события просто теряются.

const queue: ClientEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

type Props = NonNullable<ClientEvent['props']>;

export function track(name: ClientEventName, props?: Props): void {
  if (typeof window === 'undefined') return;
  queue.push({ id: uuid(), name, at: Math.round(serverNow()), ...(props ? { props } : {}) });
  if (!listening) {
    listening = true;
    window.addEventListener('pagehide', () => flush(true));
  }
  if (queue.length >= 20) flush();
  else timer ??= setTimeout(() => flush(), 5000);
}

function flush(keepalive = false): void {
  if (timer) clearTimeout(timer);
  timer = null;
  const events = queue.splice(0, 20);
  if (events.length === 0) return;
  void fetch('/api/v1/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ events }),
    keepalive,
  }).catch(() => {});
}
