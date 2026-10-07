'use client';

import {
  NICKNAME_HINTS,
  NICKNAME_MAX,
  type NicknameCheckResponse,
  type NicknameProblem,
  nicknameShapeProblem,
} from '@updown/contracts';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useAccountSheet } from '@/features/account/account';
import { track } from '@/shared/lib/analytics';
import { api, ApiRequestError } from '@/shared/lib/api';
import { realtime } from '@/shared/lib/realtime';
import { useSession } from '@/shared/state/session';
import { CoinMark, Icon } from '@/shared/ui/Icon';
import { Wordmark } from '@/shared/ui/Wordmark';

type Check = { state: 'idle' | 'checking' | 'ok' } | { state: 'problem'; problem: NicknameProblem; suggestions: string[] };

/** Ответ сервера по конкретному значению ника: устаревшие ответы просто не совпадут по value. */
interface ServerCheck {
  value: string;
  res: NicknameCheckResponse;
}

/**
 * Первый экран поверх живого графика: ник уже предложен, игрок либо сразу жмёт "Играть",
 * либо вписывает свой. Один шаг до первого прогноза, регистрация не нужна.
 */
export function Onboarding() {
  const setMe = useSession((s) => s.setMe);
  const showAccount = useAccountSheet((s) => s.show);
  const [nickname, setNickname] = useState('');
  const [server, setServer] = useState<ServerCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applySuggestion = (n: string) => {
    // предложенный сервером ник заведомо свободен
    setNickname(n);
    setServer({ value: n, res: { value: n, available: true, problem: null, suggestions: [] } });
    setError(null);
  };
  const suggest = () => {
    api
      .suggestNickname()
      .then(({ nickname: n }) => applySuggestion(n))
      .catch(() => {
        // без подсказки игрок впишет ник сам
      });
  };

  useEffect(suggest, []);
  useEffect(() => track('onboarding_view'), []);

  // Форма проверяется сразу при рендере, занятость и запреты - на сервере с паузой после ввода.
  const value = nickname.trim();
  const shape = value ? nicknameShapeProblem(value) : null;
  useEffect(() => {
    if (!value || shape || server?.value === value) return;
    const timer = setTimeout(() => {
      api
        .checkNickname(value)
        .then((res) => setServer({ value, res }))
        .catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
  }, [value, shape, server?.value]);

  const check: Check = !value
    ? { state: 'idle' }
    : shape
      ? { state: 'problem', problem: shape, suggestions: [] }
      : server?.value !== value
        ? { state: 'checking' }
        : server.res.available
          ? { state: 'ok' }
          : { state: 'problem', problem: server.res.problem ?? 'taken', suggestions: server.res.suggestions };

  const play = async () => {
    if (!value || check.state === 'problem') return;
    setBusy(true);
    setError(null);
    try {
      const me = await api.createGuest(value);
      setMe(me);
      // сервер узнаёт игрока по cookie при подключении: переподключаем сокет
      realtime.restart();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Не получилось начать. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  };

  const problem = check.state === 'problem' ? check : null;

  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end lg:justify-center">
      <div className="absolute inset-0 bg-linear-to-b from-bg/10 via-bg/65 to-bg/95" />
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        className="onboarding-wrap relative"
      >
        <div className="material onboarding-card">
          <div className="onboarding-kicker"><Wordmark /><span className="eyebrow">Начните здесь</span></div>
          <h1 className="onboarding-title">Реальный рынок.<br /><span>Ваше решение.</span></h1>
          <p className="mt-3 text-label leading-5 text-text-2">
            Куда пойдёт цена: выше или ниже? Сделайте прогноз на реальные котировки с игровыми Coins. Без регистрации.
          </p>
          <div className="welcome-balance mt-5">
            <CoinMark size={22} />
            <span className="tnum text-body font-semibold">10 000 Coins</span>
            <span className="text-label text-text-3">на старт</span>
          </div>

          <form
            className="mt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void play();
            }}
          >
            <label htmlFor="nickname" className="text-caption font-medium text-text-2">
              Ваш игровой ник
            </label>
            <div
              className="nickname-well"
              style={problem ? { borderColor: 'var(--color-down)' } : undefined}
            >
              <input
                id="nickname"
                value={nickname}
                maxLength={NICKNAME_MAX}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(e) => setNickname(e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-body font-medium outline-none placeholder:text-text-3"
                placeholder="Придумайте ник"
                aria-invalid={problem ? true : undefined}
                aria-describedby="nickname-hint"
              />
              <button
                type="button"
                onClick={suggest}
                className="icon-control"
                aria-label="Другой вариант ника"
              >
                <Icon name="dice" />
              </button>
            </div>
            <div id="nickname-hint" className="mt-2 min-h-5 text-caption" aria-live="polite">
              {problem ? (
                <span className="text-down">
                  {NICKNAME_HINTS[problem.problem]}
                  {problem.suggestions.length > 0 && (
                    <span className="text-text-2">
                      {' '}Свободны:{' '}
                      {problem.suggestions.map((s, i) => (
                        <button key={s} type="button" onClick={() => applySuggestion(s)} className="font-semibold text-accent-text underline-offset-2 hover:underline">
                          {s}
                          {i < problem.suggestions.length - 1 ? ', ' : ''}
                        </button>
                      ))}
                    </span>
                  )}
                </span>
              ) : error ? (
                <span className="text-down">{error}</span>
              ) : (
                <span className="text-text-3">Латиница или кириллица, цифры и подчёркивание</span>
              )}
            </div>
            <button
              type="submit"
              disabled={busy || !nickname.trim() || check.state === 'problem' || check.state === 'checking'}
              className="primary-button mt-3"
            >
              {busy ? 'Создаём игрока...' : 'Играть'}
              <Icon name="chevronRight" size={18} />
            </button>
          </form>
          <button
            type="button"
            onClick={() => showAccount('login')}
            className="mt-2 h-11 w-full text-label font-medium text-text-2"
          >
            Уже играли? <span className="text-accent-text">Войти по почте</span>
          </button>
          <p className="mt-1 text-center text-caption text-text-3">
            Coins - игровая валюта. Их нельзя вывести или обменять на деньги.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
