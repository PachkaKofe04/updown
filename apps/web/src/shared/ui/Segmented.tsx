'use client';

import { motion } from 'motion/react';
import { useId } from 'react';

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
}

/** Сегментный переключатель: равная ширина, крупные зоны нажатия, плавный индикатор выбора. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange(value: T): void;
  label: string;
}) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} className="flex h-[var(--h-control)] gap-1 rounded-control bg-surface-2 p-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className="relative flex-1 rounded-[10px] text-label font-semibold text-text-2 transition-colors duration-[var(--t-fast)] disabled:opacity-35 aria-checked:text-text-1"
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-[10px] bg-surface-3 shadow-raise"
                transition={{ type: 'spring', stiffness: 520, damping: 40, mass: 0.7 }}
              />
            )}
            <span className="tnum relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
