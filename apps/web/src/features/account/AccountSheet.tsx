'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { track } from '@/shared/lib/analytics';
import { api } from '@/shared/lib/api';
import { formatCoins } from '@/shared/lib/format';
import { useSession } from '@/shared/state/session';
import { CoinMark } from '@/shared/ui/Icon';
import { Sheet } from '@/shared/ui/Sheet';
import { applySession, useAccountSheet } from './account';
import { EmailFlow } from './EmailFlow';

/** Аккаунт: кто играет, сохранён ли прогресс; сохранение по почте, вход и выход. */
export function AccountSheet() {
  const open = useAccountSheet((s) => s.open);
  const intent = useAccountSheet((s) => s.intent);
  const hide = useAccountSheet((s) => s.hide);
  const anonymous = useSession((s) => s.me === null);
  const title = anonymous || intent === 'login' ? 'Вход по почте' : 'Аккаунт';

  useEffect(() => {
    if (open) track('account_opened', { intent });
  }, [open, intent]);

  return (
    <Sheet open={open} onClose={hide} title={title}>
      {anonymous || intent === 'login' ? <EmailFlow action="login" onDone={hide} /> : <AccountBody onDone={hide} />}
    </Sheet>
  );
}

function AccountBody({ onDone }: { onDone(): void }) {
  const me = useSession((s) => s.me);
  const queries = useQueryClient();
  const [flow, setFlow] = useState<'link' | 'login' | null>(null);
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  if (flow) return <EmailFlow action={flow} onDone={onDone} />;

  const registered = me.user.kind === 'registered';
  const logout = async () => {
    setBusy(true);
    try {
      await api.logout();
      applySession(null, true, queries);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 px-5 pb-4">
      <div className="welcome-balance justify-between">
        <div>
          <div className="text-emph font-semibold">{me.user.nickname}</div>
          <div className="text-caption text-text-2">
            {registered ? `Прогресс сохранён: ${me.user.email ?? 'почта'}` : 'Гость: прогресс хранится только в этом браузере'}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <CoinMark size={17} />
          <span className="tnum text-label font-semibold">{formatCoins(me.wallet.balance)}</span>
        </div>
      </div>

      {registered ? (
        <>
          <p className="text-caption text-text-2">На другом устройстве войдите по этой же почте: баланс и история будут там же.</p>
          <button type="button" disabled={busy} onClick={() => void logout()} className="h-12 w-full rounded-control border border-hairline text-label font-medium text-text-2">
            {busy ? 'Выходим...' : 'Выйти'}
          </button>
        </>
      ) : (
        <>
          <p className="text-label text-text-2">
            Сохраните прогресс на почту, чтобы не потерять баланс и историю и играть с телефона и компьютера.
          </p>
          <button type="button" onClick={() => setFlow('link')} className="primary-button">
            Сохранить прогресс
          </button>
          <button type="button" onClick={() => setFlow('login')} className="h-11 w-full text-label font-medium text-text-2">
            Уже есть аккаунт? Войти
          </button>
        </>
      )}
    </div>
  );
}
