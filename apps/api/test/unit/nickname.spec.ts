import { nicknameShapeProblem } from '@updown/contracts';
import { describe, expect, it } from 'vitest';
import { generateNickname, nicknameProblem } from '../../src/modules/identity/nickname.js';

describe('nickname', () => {
  it('принимает латиницу или кириллицу с цифрами и подчёркиванием', () => {
    for (const ok of ['Wolf', 'IronBull42', 'Nova_7', 'Артём', 'Тигр_2026', 'abc']) {
      expect(nicknameProblem(ok), ok).toBeNull();
    }
  });

  it('отвергает неверную форму', () => {
    expect(nicknameShapeProblem('ab')).toBe('length');
    expect(nicknameShapeProblem('a'.repeat(17))).toBe('length');
    expect(nicknameShapeProblem('7wolf')).toBe('start');
    expect(nicknameShapeProblem('_wolf')).toBe('start');
    expect(nicknameShapeProblem('wolf fx')).toBe('chars');
    expect(nicknameShapeProblem('wolf-fx')).toBe('chars');
    // русская "А" в начале латинского ника - подделка
    expect(nicknameShapeProblem('Аdmin')).toBe('mixed');
    expect(nicknameShapeProblem('Wolfбот')).toBe('mixed');
  });

  it('служебные имена зарезервированы, в том числе как начало ника', () => {
    expect(nicknameProblem('admin')).toBe('reserved');
    expect(nicknameProblem('Admin_1')).toBe('reserved');
    expect(nicknameProblem('UpDownTeam')).toBe('reserved');
    expect(nicknameProblem('Поддержка')).toBe('reserved');
  });

  it('ловит мат с подменами цифрами и подчёркиваниями', () => {
    expect(nicknameProblem('Fuck_you')).toBe('profanity');
    expect(nicknameProblem('sh1t')).toBe('profanity');
    expect(nicknameProblem('Сука_123')).toBe('profanity');
    expect(nicknameProblem('blyat777')).toBe('profanity');
  });

  it('сгенерированные ники всегда проходят правила', () => {
    for (let i = 0; i < 1000; i++) {
      const n = generateNickname();
      expect(nicknameProblem(n), n).toBeNull();
      expect(n.length).toBeLessThanOrEqual(16);
    }
  });
});
