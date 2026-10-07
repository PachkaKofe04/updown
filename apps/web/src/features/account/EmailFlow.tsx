'use client';

import { EMAIL_CODE_LENGTH } from '@updown/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { track } from '@/shared/lib/analytics';
import { api, ApiRequestError } from '@/shared/lib/api';
import { useSession } from '@/shared/state/session';
import { Icon } from '@/shared/ui/Icon';
import { applySession } from './account';

type Action = 'link' | 'login';
type Step = 'email' | 'code' | 'conflict' | 'not_found' | 'done';

const errorText = (e: unknown) =>
  e instanceof ApiRequestError ? e.message : 'Не получилось. Проверьте интернет и попробуйте ещё раз.';

/**
 * Почта -> код из письма -> готово. link сохраняет текущего гостя, login входит в аккаунт
 * с этой почтой. Если почта уже у другого аккаунта, тем же кодом можно сразу войти в него.
 */
export function EmailFlow({ action: initialAction, onDone }: { action: Action; onDone(): void }) {
  const queries = useQueryClient();
  const isGuest = useSession((s) => s.me?.user.kind === 'guest');
  const [action, setAction] = useState(initialAction);
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (step !== 'code') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [step]);

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.emailStart(email.trim());
      track('save_progress_started', { action });
      setResendAt(Date.now() + res.resendAfterSec * 1000);
      setCode('');
      setStep('code');
    } catch (e) {
      setError(errorText(e));
      // код уже отправляли недавно: он ещё действует, поэтому сразу к вводу кода
      if (e instanceof ApiRequestError && e.code === 'rate_limited') {
        setResendAt(Date.now() + 60_000);
        setCode('');
        setStep('code');
      }
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value: string, as: Action) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.emailVerify(email.trim(), value, as);
      applySession(res.me, res.switched, queries);
      setAction(as);
      setStep('done');
    } catch (e) {
      const code = e instanceof ApiRequestError ? e.code : null;
      if (code === 'email_in_use') setStep('conflict');
      else if (code === 'account_not_found') setStep('not_found');
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'done') {
    return (
      <div className="flex flex-col items-center gap-3 px-5 pb-4 pt-2 text-center">
        <span className="prediction-symbol text-up">
          <Icon name="check" size={20} strokeWidth={2.2} />
        </span>
        <p className="text-emph font-semibold">{action === 'link' ? 'Прогресс сохранён' : 'Вы вошли в аккаунт'}</p>
        <p className="max-w-[300px] text-label text-text-2">
          {action === 'link'
            ? 'Баланс, история и статистика привязаны к почте. На другом устройстве войдите по этой же почте.'
            : 'Баланс и история аккаунта загружены на это устройство.'}
        </p>
        <button type="button" onClick={onDone} className="primary-button mt-2">
          Играть
        </button>
      </div>
    );
  }

  if (step === 'conflict' || step === 'not_found') {
    const conflict = step === 'conflict';
    return (
      <div className="space-y-3 px-5 pb-4">
        <p className="text-label text-text-1">
          {conflict ? 'Эта почта уже привязана к другому аккаунту.' : 'Аккаунт с этой почтой не найден.'}
        </p>
        <p className="text-caption text-text-2">
          {conflict
            ? 'Можно войти в него тем же кодом. Прогресс этого гостя в тот аккаунт не перенесётся.'
            : isGuest
              ? 'Можно сохранить на эту почту текущий прогресс.'
              : 'Начните игру и сохраните прогресс на эту почту.'}
        </p>
        {error && <p className="text-caption text-down">{error}</p>}
        {(conflict || isGuest) && (
          <button type="button" disabled={busy} onClick={() => void verify(code, conflict ? 'login' : 'link')} className="primary-button">
            {conflict ? 'Войти в аккаунт' : 'Сохранить прогресс'}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setStep('email');
            setError(null);
          }}
          className="h-11 w-full text-label font-medium text-text-2"
        >
          Другая почта
        </button>
      </div>
    );
  }

  if (step === 'code') {
    const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));
    return (
      <form
        className="space-y-3 px-5 pb-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === EMAIL_CODE_LENGTH) void verify(code, action);
        }}
      >
        <p className="text-label text-text-2">
          Код отправлен на <span className="text-text-1">{email.trim()}</span>. Письмо может прийти в папку «Спам».
        </p>
        <label htmlFor="email-code" className="sr-only">
          Код из письма
        </label>
        <div className="nickname-well">
          <input
            id="email-code"
            value={code}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={EMAIL_CODE_LENGTH}
            placeholder="Код из письма"
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, EMAIL_CODE_LENGTH);
              setCode(digits);
              // шесть цифр введены - проверяем без лишнего нажатия
              if (digits.length === EMAIL_CODE_LENGTH && !busy) void verify(digits, action);
            }}
            className="tnum min-w-0 flex-1 bg-transparent text-emph font-semibold tracking-[0.3em] outline-none placeholder:tracking-normal placeholder:text-text-3"
          />
        </div>
        <p className="min-h-5 text-caption" aria-live="polite">
          {error ? <span className="text-down">{error}</span> : busy ? <span className="text-text-3">Проверяем...</span> : null}
        </p>
        <button type="submit" disabled={busy || code.length !== EMAIL_CODE_LENGTH} className="primary-button">
          Подтвердить
        </button>
        <div className="flex justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              setStep('email');
              setError(null);
            }}
            className="h-11 text-label font-medium text-text-2"
          >
            Другая почта
          </button>
          <button
            type="button"
            disabled={wait > 0 || busy}
            onClick={() => void sendCode()}
            className="h-11 text-label font-medium text-accent-text disabled:text-text-3"
          >
            {wait > 0 ? `Новый код через ${wait} с` : 'Отправить код ещё раз'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      className="space-y-3 px-5 pb-4"
      onSubmit={(e) => {
        e.preventDefault();
        void sendCode();
      }}
    >
      <p className="text-label text-text-2">
        {action === 'link'
          ? 'Пришлём код на почту. Баланс, история и статистика сохранятся, и войти можно будет с любого устройства.'
          : 'Пришлём код на почту, к которой привязан аккаунт.'}
      </p>
      {action === 'login' && isGuest && (
        <p className="text-caption text-warning">Прогресс этого гостя в аккаунт не перенесётся.</p>
      )}
      <label htmlFor="email" className="sr-only">
        Почта
      </label>
      <div className="nickname-well">
        <input
          id="email"
          type="email"
          value={email}
          autoComplete="email"
          inputMode="email"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Почта"
          onChange={(e) => setEmail(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-body font-medium outline-none placeholder:text-text-3"
        />
      </div>
      <p className="min-h-5 text-caption text-down" aria-live="polite">
        {error}
      </p>
      <button type="submit" disabled={busy || !/^\S+@\S+\.\S+$/.test(email.trim())} className="primary-button">
        {busy ? 'Отправляем...' : 'Получить код'}
      </button>
    </form>
  );
}
