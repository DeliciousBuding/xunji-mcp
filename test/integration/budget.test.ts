import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheTtlSeconds } from '../../src/cache';
import { todayInXunjiZone } from '../../src/domain/date';
import { consumeScanBudget, scanBudgetStatus } from '../../src/index/store';
import { kvWritesToday, utcDay } from '../../src/kv-budget';
import { readDay } from '../../src/service/day-read';
import type { Env } from '../../src/types';
import { syntheticDay } from '../helpers/synthetic';

const testEnv = env as unknown as Env;
const database = testEnv.DB!;
const realFetch = globalThis.fetch;

function kvSpy(): { kv: KVNamespace; puts: string[] } {
  const puts: string[] = [];
  const kv = {
    get: (...args: Parameters<KVNamespace['get']>) => testEnv.CACHE_KV.get(...args),
    put: async (key: string, value: string, options?: KVNamespacePutOptions) => {
      puts.push(key);
      await testEnv.CACHE_KV.put(key, value, options);
    },
  } as unknown as KVNamespace;
  return { kv, puts };
}

beforeEach(async () => {
  await database.batch([
    database.prepare('DELETE FROM set_fact'),
    database.prepare('DELETE FROM movement'),
    database.prepare('DELETE FROM session'),
    database.prepare('DELETE FROM scan_day'),
    database.prepare('DELETE FROM meta'),
    database.prepare('DELETE FROM kv_budget'),
    database.prepare('DELETE FROM scan_budget'),
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubUpstream(): void {
  vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { datestr?: string };
    const date = body.datestr ?? '2026-01-01';
    return Response.json({ res: syntheticDay(date, { rest: false }) });
  });
}

describe('KV quota guards', () => {
  it('does not write KV during a scan read', async () => {
    stubUpstream();
    const { kv, puts } = kvSpy();
    const scanEnv = { ...testEnv, CACHE_KV: kv };
    for (const date of ['2025-01-02', '2025-01-03', '2025-01-04']) {
      const result = await readDay(scanEnv, {
        subject: 'scan-subject',
        datestr: date,
        useCache: false,
        persistCache: false,
      });
      expect(result.status).toBe('data');
    }
    expect(puts).toEqual([]);
  });

  it('never caches historical days, even on the normal read path', async () => {
    stubUpstream();
    const { kv, puts } = kvSpy();
    await readDay({ ...testEnv, CACHE_KV: kv }, { subject: 'read-subject', datestr: '2025-01-02' });
    expect(cacheTtlSeconds('2025-01-02')).toBe(0);
    expect(puts).toEqual([]);
  });

  it('caches today and serves the second read from KV', async () => {
    stubUpstream();
    const { kv, puts } = kvSpy();
    const today = todayInXunjiZone();
    const first = await readDay(
      { ...testEnv, CACHE_KV: kv },
      { subject: 'today-subject', datestr: today },
    );
    const second = await readDay(
      { ...testEnv, CACHE_KV: kv },
      { subject: 'today-subject', datestr: today },
    );
    expect(first.status).toBe('data');
    expect(puts).toHaveLength(1);
    expect(second.status).toBe('data');
    if (second.status === 'data') expect(second.cached).toBe(true);
  });

  it('stops writing KV after the daily budget', async () => {
    stubUpstream();
    const { kv, puts } = kvSpy();
    const budgetEnv = { ...testEnv, CACHE_KV: kv, KV_WRITE_DAILY_BUDGET: '2' };
    const today = todayInXunjiZone();
    await readDay(budgetEnv, { subject: 'a', datestr: today, fresh: true });
    await readDay(budgetEnv, { subject: 'b', datestr: today, fresh: true });
    const third = await readDay(budgetEnv, { subject: 'c', datestr: today, fresh: true });
    expect(puts).toHaveLength(2);
    expect(third.status === 'data' && third.cacheDegraded).toBe(true);
    expect(await kvWritesToday(budgetEnv)).toEqual({ used: 3, budget: 2 });
  });

  it('caps scan days per UTC day and resets on the next day', async () => {
    const day = utcDay();
    expect(await consumeScanBudget(testEnv, 80, day)).toBe(80);
    expect(await consumeScanBudget(testEnv, 80, day)).toBe(20);
    expect(await consumeScanBudget(testEnv, 1, day)).toBe(0);
    expect((await scanBudgetStatus(testEnv, day)).remaining).toBe(0);
    expect(await consumeScanBudget(testEnv, 5, '2099-01-01')).toBe(5);
  });
});

void realFetch;
