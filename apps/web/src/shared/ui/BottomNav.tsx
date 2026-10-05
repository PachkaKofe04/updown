'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from './Icon';

// Только готовые разделы: рейтинг и профиль появятся вместе с функциональностью.
const ITEMS: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: 'Торговля', icon: 'chart' },
  { href: '/history', label: 'История', icon: 'history' },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav
      aria-label="Разделы"
      className="shrink-0 border-t border-hairline bg-bg/90 pb-[var(--safe-bottom)] backdrop-blur-md"
    >
      <ul className="mx-auto flex h-[var(--h-nav)] max-w-[480px]">
        {ITEMS.map((item) => {
          const active = item.href === '/' ? path === '/' : path.startsWith(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-full flex-col items-center justify-center gap-0.5 text-caption font-medium transition-colors duration-[var(--t-fast)] ${
                  active ? 'text-text-1' : 'text-text-3'
                }`}
              >
                <Icon name={item.icon} size={22} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
