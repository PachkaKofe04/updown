import type { SVGProps } from 'react';

// Набор иконок в одной сетке 24x24 и одной толщине линии: несогласованные иконки - запрет визуала.
const PATHS = {
  arrowUp: 'M12 19V5M5.5 11.5 12 5l6.5 6.5',
  arrowDown: 'M12 5v14M5.5 12.5 12 19l6.5-6.5',
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 6 6 6-6 6',
  close: 'M6 6l12 12M18 6 6 18',
  dice: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM8.5 8.5h.01M15.5 15.5h.01M15.5 8.5h.01M8.5 15.5h.01M12 12h.01',
  chart: 'M4 19h16M5 15l4-5 4 3 6-7',
  history: 'M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 4.5V9H8M12 7.5V12l3 2',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  minus: 'M5 12h14',
  plus: 'M12 5v14M5 12h14',
  shield: 'M12 3.5 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-2.5Z',
  signal: 'M4 18v-2M9 18v-5M14 18V9M19 18V5',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, strokeWidth = 1.75, ...rest }: { name: IconName; size?: number; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Знак Coins: монета с отметками "вверх" и "вниз" - знак игры, а не казино. */
export function CoinMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="coin-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ecd08a" />
          <stop offset="1" stopColor="#b8913f" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="10" fill="url(#coin-g)" />
      <circle cx="12" cy="12" r="7.6" fill="none" stroke="#6b5016" strokeOpacity=".35" strokeWidth="1" />
      <path d="M8.6 10.4 12 7.2l3.4 3.2M8.6 13.6 12 16.8l3.4-3.2" fill="none" stroke="#4a370d" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
