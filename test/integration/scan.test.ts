import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  dueScanDates,
  enqueueRange,
  enqueueRefresh,
  getCoverage,
  markScanResult,
  replaceDay,
  setHistoryStart,
  setScanPaused,
} from '../../src/index/store';
import type { Env } from '../../src/types';
import { syntheticDay } from '../helpers/synthetic';

const testEnv = env as unknown as Env;
const database = testEnv.DB!;

beforeEach(async () => {
  await database.batch([
    database.prepare('DELETE FROM set_fact'),
    database.prepare('DELETE FROM movement'),
    database.prepare('DELETE FROM session'),
    database.prepare('DELETE FROM scan_day'),
    database.prepare('DELETE FROM meta'),
  ]);
});

describe('scan queue', () => {
  it('resumes only days whose retry time has passed', async () => {
    await enqueueRange(testEnv, '2026-02-01', '2026-02-03');
    await markScanResult(testEnv, '2026-02-01', {
      status: 'pending',
      retryAfterMs: 60_000,
      error: 'vendor pacing',
    });
    await markScanResult(testEnv, '2026-02-02', {
      status: 'error',
      retryAfterMs: 0,
      error: 'network',
    });

    const dueNow = await dueScanDates(testEnv, 10, Date.now() + 2_000);
    expect(dueNow).toContain('2026-02-02');
    expect(dueNow).toContain('2026-02-03');
    expect(dueNow).not.toContain('2026-02-01');

    const later = await dueScanDates(testEnv, 10, Date.now() + 61_000);
    expect(later).toContain('2026-02-01');
  });

  it('does not lose a completed day when a range is enqueued again', async () => {
    await enqueueRange(testEnv, '2026-02-04', '2026-02-04');
    await replaceDay(testEnv, '2026-02-04', syntheticDay('2026-02-04', { rest: false }));
    await enqueueRange(testEnv, '2026-02-01', '2026-02-05');

    const row = await database
      .prepare("SELECT status FROM scan_day WHERE datestr = '2026-02-04'")
      .first<{ status: string }>();
    expect(row?.status).toBe('complete');
  });

  it('refresh re-queues a scanned day and replaces deleted source records', async () => {
    const date = '2026-02-05';
    await replaceDay(testEnv, date, syntheticDay(date, { rest: false }));
    await enqueueRefresh(testEnv, date, date);
    const pending = await dueScanDates(testEnv, 5, Date.now());
    expect(pending).toContain(date);

    await replaceDay(testEnv, date, syntheticDay(date, { rest: true }));
    const rows = await database
      .prepare('SELECT COUNT(*) AS n FROM set_fact WHERE datestr = ?')
      .bind(date)
      .first<{ n: number }>();
    expect(rows?.n).toBe(0);
    const coverage = await getCoverage(testEnv, date, date);
    expect(coverage.emptyDays).toBe(1);
  });

  it('pause is durable state, not a process flag', async () => {
    await setScanPaused(testEnv, true);
    const row = await database
      .prepare("SELECT value FROM meta WHERE key = 'scan_paused'")
      .first<{ value: string }>();
    expect(row?.value).toBe('true');
    await setScanPaused(testEnv, false);
  });

  it('reports partial coverage instead of treating unscanned days as empty', async () => {
    await setHistoryStart(testEnv, '2026-02-01');
    await replaceDay(testEnv, '2026-02-01', syntheticDay('2026-02-01', { rest: false }));
    const coverage = await getCoverage(testEnv, '2026-02-01', '2026-02-10');
    expect(coverage.complete).toBe(false);
    expect(coverage.pendingDays).toBe(9);
    expect(coverage.earliestRecord).toBe('2026-02-01');
  });
});
