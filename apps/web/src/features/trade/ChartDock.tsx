'use client';

import { AnimatePresence, motion } from 'motion/react';
import { type Ref, useEffect } from 'react';
import { useSession } from '@/shared/state/session';
import { useTrade } from '@/shared/state/trade';
import { ActiveCard } from './ActiveCard';
import { ResultCard } from './ResultCard';

const ENTER = { opacity: 0, y: 12, scale: 0.97 };
const SHOWN = { opacity: 1, y: 0, scale: 1 };
const LEAVE = { opacity: 0, y: 6 };

/**
 * Одно место поверх низа графика: активный прогноз, а после экспирации - его итог.
 * Итог встаёт на место карточки (короткое событие, 3 секунды), график резервирует под слот место,
 * поэтому линия цены и точка выхода под карточкой не прячутся.
 */
export function ChartDock({ ref }: { ref: Ref<HTMLDivElement> }) {
  const banner = useTrade((s) => s.banner);
  const dismiss = useTrade((s) => s.dismissBanner);
  const open = useTrade((s) => s.open);
  const streak = useSession((s) => s.me?.stats.currentStreak ?? 0);
  const list = Object.values(open).sort((a, b) => a.expiresAt - b.expiresAt);
  const current = list[0];

  useEffect(() => {
    if (!banner) return;
    if (banner.prediction.status === 'won') navigator.vibrate?.([10, 40, 14]);
    const timer = setTimeout(dismiss, 3000);
    return () => clearTimeout(timer);
  }, [banner, dismiss]);

  return (
    // Карточки лежат в одной ячейке сетки: смена "активный -> итог" идёт на месте, а слот
    // (и место под ним на графике) освобождается только после того, как карточка растворилась.
    <div ref={ref} className="chart-dock">
      <AnimatePresence initial={false}>
        {banner ? (
          <motion.button
            key={`result-${banner.prediction.id}`}
            type="button"
            onClick={dismiss}
            initial={ENTER}
            animate={SHOWN}
            exit={LEAVE}
            transition={{ type: 'spring', stiffness: 460, damping: 32 }}
            className="block w-full text-left"
            aria-live="assertive"
          >
            <ResultCard p={banner.prediction} streak={streak} />
          </motion.button>
        ) : current ? (
          <motion.div
            key="active"
            initial={ENTER}
            animate={SHOWN}
            exit={LEAVE}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <ActiveCard prediction={current} more={list.length - 1} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
