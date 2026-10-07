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
    <div role="radiogroup" aria-label={label} className="segmented">
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
            className="segment"
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="segment-indicator"
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
