import { describe, expect, it } from 'vitest';
import { decideOutcome, payoutFor, profitFor } from '../../src/modules/updown/outcome.js';

describe('outcome', () => {
  it('UP выигрывает только при росте, DOWN - только при падении', () => {
    expect(decideOutcome('UP', '100.00', '100.01')).toBe('won');
    expect(decideOutcome('UP', '100.00', '99.99')).toBe('lost');
    expect(decideOutcome('DOWN', '100.00', '99.99')).toBe('won');
    expect(decideOutcome('DOWN', '100.00', '100.01')).toBe('lost');
  });

  it('равные цены - ничья, в том числе при разной записи', () => {
    expect(decideOutcome('UP', '1.118045', '1.118045')).toBe('tie');
    expect(decideOutcome('DOWN', '85850.10', '85850.1')).toBe('tie');
  });

  it('минимальное изменение цены решает исход', () => {
    expect(decideOutcome('UP', '1.118045', '1.118046')).toBe('won');
    expect(decideOutcome('UP', '1.118045', '1.118044')).toBe('lost');
  });

  it('прибыль округляется вниз', () => {
    expect(profitFor(1000, 8500)).toBe(850);
    expect(profitFor(15, 8500)).toBe(12);
    expect(profitFor(10, 8500)).toBe(8);
    expect(profitFor(1, 8500)).toBe(0);
    expect(profitFor(9_000_000_000, 8500)).toBe(7_650_000_000);
  });

  it('выплата по статусу', () => {
    expect(payoutFor('won', 1000, 8500)).toBe(1850);
    expect(payoutFor('lost', 1000, 8500)).toBe(0);
    expect(payoutFor('tie', 1000, 8500)).toBe(1000);
    expect(payoutFor('void', 1000, 8500)).toBe(1000);
  });
});
