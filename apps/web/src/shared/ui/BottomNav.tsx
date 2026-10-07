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
      className="bottom-nav"
    >
      <ul>
        {ITEMS.map((item) => {
          const active = item.href === '/' ? path === '/' : path.startsWith(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className="nav-link"
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
