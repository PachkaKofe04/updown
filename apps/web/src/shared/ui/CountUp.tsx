'use client';

import { animate } from 'motion/react';
import { useEffect, useRef } from 'react';

/** Плавное изменение числа (баланс): старое значение "доезжает" до нового. Без анимации при reduce-motion. */
export function CountUp({ value, format, className }: { value: number; format(n: number): string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = shown.current;
    if (from === value) {
      el.textContent = format(value);
      return;
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      shown.current = value;
      el.textContent = format(value);
      return;
    }
    const controls = animate(from, value, {
      duration: Math.min(0.9, 0.35 + Math.abs(value - from) / 40_000),
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        shown.current = Math.round(v);
        el.textContent = format(shown.current);
      },
    });
    return () => controls.stop();
  }, [value, format]);

  return (
    <span ref={ref} className={className}>
      {format(value)}
    </span>
  );
}
