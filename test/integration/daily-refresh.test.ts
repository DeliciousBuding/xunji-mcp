import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { enqueueDailyGap } from '../../src/index/daily-refresh';
import { setMeta } from '../../src/index/store';
import type { Env } from '../../src/types';

const testEnv = env as unknown as Env;
const database = testEnv.DB!;

beforeEach(async () => {
  await database.batch([
    database.prepare('DELETE FROM scan_day'),
    database.prepare('DELETE FROM meta'),
  ]);
});

async function markScanned(dates: string[]): Promise<void> {
  await database.batch(
    dates.map((date) =>
      database.prepare("INSERT INTO scan_day (datestr, status) VALUES (?, 'complete')").bind(date),
    ),
  );
}

describe('daily incremental refresh', () => {
  it('enqueues only the gap after the latest scanned day, excluding today', async () => {
    await setMeta(testEnv, 'history_start', '2026-11-01');
    await markScanned(['2026-11-16', '2026-11-17', '2026-11-18']);

    const gap = await enqueueDailyGap(testEnv, '2026-11-20');

    expect(gap).toEqual({ from: '2026-11-19', to: '2026-11-19', enqueued: 1 });
    const row = await database
      .prepare('SELECT status FROM scan_day WHERE datestr = ?')
      .bind('2026-11-19')
      .first<{ status: string }>();
    expect(row?.status).toBe('pending');
  });

  it('fills from the configured start when the index is empty', async () => {
    await setMeta(testEnv, 'history_start', '2026-11-10');

    const gap = await enqueueDailyGap(testEnv, '2026-11-13');

    expect(gap).toEqual({ from: '2026-11-10', to: '2026-11-12', enqueued: 3 });
  });

  it('does nothing when the index already reaches yesterday', async () => {
    await setMeta(testEnv, 'history_start', '2026-11-01');
    await markScanned(['2026-11-18', '2026-11-19']);

    expect(await enqueueDailyGap(testEnv, '2026-11-20')).toBeNull();
  });

  it('does nothing until the operator sets a history start', async () => {
    expect(await enqueueDailyGap(testEnv, '2026-11-20')).toBeNull();
    const count = await database
      .prepare('SELECT COUNT(*) AS n FROM scan_day')
      .first<{ n: number }>();
    expect(Number(count?.n)).toBe(0);
  });
});
