import { describe, expect, it } from 'vitest';
import { loginCodeEmail } from '../../src/modules/identity/email-templates.js';

describe('письмо с кодом входа', () => {
  const mail = loginCodeEmail('player@example.com', '048213', 10);

  it('код в теме, тексте и HTML; срок действия указан', () => {
    expect(mail.to).toBe('player@example.com');
    expect(mail.subject).toBe('Код входа UpDown: 048213');
    expect(mail.text).toContain('048213');
    expect(mail.text).toContain('10 минут');
    expect(mail.html).toContain('>048213</div>');
  });

  it('без картинок и внешних ссылок: меньше шансов попасть в спам', () => {
    expect(mail.html).not.toMatch(/<img|https?:\/\//i);
  });
});
