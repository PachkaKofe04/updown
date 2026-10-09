import type { Mail } from './mail.js';

/**
 * Письмо с кодом входа. Без картинок и внешних ссылок (меньше шансов попасть в спам),
 * светлый фон и встроенные стили (их понимают все почтовые программы), текстовая версия
 * для клиентов без HTML. Код вынесен в тему: он виден прямо в уведомлении о письме.
 */
export function loginCodeEmail(to: string, code: string, ttlMin: number): Mail {
  const subject = `Код входа UpDown: ${code}`;
  const text = [
    `Ваш код входа в UpDown: ${code}`,
    '',
    `Введите его на сайте. Код действует ${ttlMin} минут и подходит один раз.`,
    'Если вы не запрашивали код, просто проигнорируйте это письмо: без кода в аккаунт не войти.',
  ].join('\n');
  const html = `<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#eef2f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f5;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border-radius:16px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#111820;">
<tr><td style="padding:28px 28px 8px;font-size:15px;font-weight:700;letter-spacing:0.18em;color:#2a4a62;">&#8593;&#8595; UPDOWN</td></tr>
<tr><td style="padding:8px 28px 0;font-size:20px;font-weight:600;line-height:28px;">Код входа</td></tr>
<tr><td style="padding:8px 28px 0;font-size:14px;line-height:21px;color:#4b5a67;">Введите его на сайте, чтобы сохранить прогресс или войти в аккаунт.</td></tr>
<tr><td style="padding:20px 28px;">
<div style="background:#f1f5f8;border:1px solid #dbe4eb;border-radius:12px;padding:16px;text-align:center;font-size:32px;line-height:40px;font-weight:700;letter-spacing:0.32em;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;">${code}</div>
</td></tr>
<tr><td style="padding:0 28px 24px;font-size:13px;line-height:20px;color:#6b7884;">Код действует ${ttlMin} минут и подходит один раз. Если вы не запрашивали код, просто проигнорируйте это письмо: без кода в аккаунт не войти.</td></tr>
</table>
<div style="padding:16px 12px 0;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;color:#8a97a3;">UpDown - прогнозы на реальные котировки с игровыми Coins.</div>
</td></tr>
</table>
</body>
</html>`;
  return { to, subject, text, html };
}
