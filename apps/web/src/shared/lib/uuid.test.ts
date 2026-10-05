import { CreatePredictionBodySchema } from '@updown/contracts';
import { describe, expect, it } from 'vitest';
import { uuid } from './uuid';

describe('uuid', () => {
  it('сервер принимает его как clientRequestId', () => {
    for (let i = 0; i < 200; i++) {
      const id = uuid();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      const body = { assetId: 'BTCUSD', direction: 'UP', durationSec: 30, stake: 100, clientRequestId: id };
      expect(CreatePredictionBodySchema.safeParse(body).success).toBe(true);
    }
  });

  it('не повторяется', () => {
    const ids = new Set(Array.from({ length: 1000 }, uuid));
    expect(ids.size).toBe(1000);
  });
});
