'use client';

import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useEffect, useRef } from 'react';
import { Icon } from './Icon';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Нижняя шторка: плавно выезжает, закрывается по фону, крестику и Escape.
 * Фокус переходит в шторку, Tab не уходит под неё, после закрытия фокус возвращается туда, где был.
 */
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
  const dialogRef = useRef<HTMLDivElement>(null);
  // обработчик закрытия часто создаётся заново на каждом рендере: эффект фокуса не должен перезапускаться
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      const dialog = dialogRef.current;
      if (e.key !== 'Tab' || !dialog) return;
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const inside = dialog.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <div
          ref={dialogRef}
          className="fixed inset-0 z-40 flex items-end justify-center"
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          {/* подложка закрывает касанием, но для клавиатуры и экранного диктора есть крестик */}
          <motion.button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="absolute inset-0 bg-black/65 backdrop-blur-[4px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={onClose}
          />
          <motion.div
            className="sheet-panel"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 42 }}
          >
            <div className="sheet-grip" />
            <div className="sheet-heading">
              <h2 className="text-emph font-semibold">{title}</h2>
              <button type="button" onClick={onClose} className="icon-control -mr-2" aria-label="Закрыть" data-autofocus>
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
