// Серверное время на клиенте: смещение по замерам ping/pong (медиана последних, с поправкой на задержку).
// Таймеры прогнозов считаются от серверного времени, а не от часов телефона.

let offset = 0;
let calibrated = false;
const samples: number[] = [];

export function serverNow(): number {
  return Date.now() + offset;
}

export function isClockCalibrated(): boolean {
  return calibrated;
}

/** Грубая оценка по первому сообщению сервера, пока нет замеров ping/pong. */
export function seedClock(serverTime: number): void {
  if (samples.length === 0) offset = serverTime - Date.now();
}

export function addClockSample(clientSent: number, serverTime: number, clientReceived: number): void {
  const rtt = clientReceived - clientSent;
  if (rtt < 0 || rtt > 5000) return;
  samples.push(serverTime + rtt / 2 - clientReceived);
  if (samples.length > 7) samples.shift();
  const sorted = [...samples].sort((a, b) => a - b);
  offset = sorted[sorted.length >> 1]!;
  calibrated = true;
}
