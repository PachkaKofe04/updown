'use client';

import { AnimatePresence, motion } from 'motion/react';
import { create } from 'zustand';
import { Icon } from './Icon';

interface Toast {
  id: number;
  text: string;
}

interface ToastState {
  toasts: Toast[];
  push(text: string): void;
  remove(id: number): void;
}

let seq = 0;

export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (text) => {
    // одинаковое сообщение не дублируем
    if (get().toasts.some((t) => t.text === text)) return;
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts.slice(-1), { id, text }] }));
    setTimeout(() => get().remove(id), 3600);
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Спокойные сообщения об ошибках сверху экрана, не перекрывают торговые кнопки. */
export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const remove = useToasts((s) => s.remove);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(var(--safe-top)+8px)] z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            type="button"
            onClick={() => remove(t.id)}
            className="material pointer-events-auto flex w-full max-w-[440px] items-start gap-3 rounded-card px-4 py-3 text-left text-label text-text-1 shadow-float"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <Icon name="info" size={18} className="mt-px shrink-0 text-warning" />
            <span>{t.text}</span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
