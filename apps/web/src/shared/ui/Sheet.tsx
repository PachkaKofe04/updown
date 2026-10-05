'use client';

import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useEffect } from 'react';
import { Icon } from './Icon';

/** Нижняя шторка: плавно выезжает, закрывается по фону, крестику и Escape. */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose(): void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={title}>
          <motion.button
            type="button"
            aria-label="Закрыть"
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={onClose}
          />
          <motion.div
            className="relative w-full max-w-[480px] rounded-t-sheet border border-b-0 border-hairline-strong bg-surface-1 pb-[calc(var(--safe-bottom)+12px)] shadow-float"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 42 }}
          >
            <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-hairline-strong" />
            <div className="flex items-center justify-between px-5 pb-2 pt-3">
              <h2 className="text-emph font-semibold">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                className="-mr-2 grid size-11 place-items-center rounded-full text-text-2 active:bg-surface-2"
                aria-label="Закрыть"
              >
                <Icon name="close" />
              </button>
            </div>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
