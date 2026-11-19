import { describe, expect, it } from 'vitest';

import { addDays, todayInXunjiZone } from '../../src/domain/date';

describe('Xunji calendar dates', () => {
  it('flips the day at midnight in Asia/Shanghai, not UTC', () => {
    // 2026-11-18T16:30Z is 2026-11-19 00:30 in Shanghai.
    expect(todayInXunjiZone(new Date('2026-11-18T16:30:00Z'))).toBe('2026-11-19');
    expect(todayInXunjiZone(new Date('2026-11-18T15:59:00Z'))).toBe('2026-11-18');
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
