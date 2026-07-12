import { describe, expect, it } from 'vitest';
import { asPaginated, statusTone, unwrapData } from './utils';

describe('API data utilities', () => {
  it('normalizes arrays and wrapped paginated responses', () => {
    expect(asPaginated<number>([1, 2])).toEqual({ items: [1, 2], total: 2, page: 1, pageSize: 2 });
    expect(asPaginated<number>({ data: { items: [3], total: 10, page: 2, pageSize: 1 } })).toEqual({
      items: [3],
      total: 10,
      page: 2,
      pageSize: 1,
    });
  });

  it('unwraps API response envelopes without changing plain values', () => {
    expect(unwrapData<{ id: string }>({ data: { id: 'one' } })).toEqual({ id: 'one' });
    expect(unwrapData<{ id: string }>({ id: 'two' })).toEqual({ id: 'two' });
  });

  it('maps operational states to restrained status tones', () => {
    expect(statusTone('SUCCEEDED')).toBe('success');
    expect(statusTone('FAILED')).toBe('danger');
    expect(statusTone('WAITING')).toBe('neutral');
  });
});
