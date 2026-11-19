import { env } from 'cloudflare:test';
import { encode } from 'gpt-tokenizer';
import { describe, it } from 'vitest';

import { addDays } from '../src/domain/date';
import { summarizeDay } from '../src/domain/normalize';
import { queryTraining, trainingOverview } from '../src/index/query';
import { replaceDay } from '../src/index/store';
import type { Env } from '../src/types';
import { syntheticDay } from '../test/helpers/synthetic';

const testEnv = env as unknown as Env & { TEST_SCHEMA: string; BENCH_DAYS: string };
const database = testEnv.DB!;

function measure(value: unknown): { bytes: number; tokens: number } {
  const text = JSON.stringify(value);
  return { bytes: new TextEncoder().encode(text).length, tokens: encode(text).length };
}

describe('benchmark', () => {
  it('measures the indexed query layer against the 0.1 range shape', async () => {
    await database.batch([
      database.prepare('DELETE FROM set_fact'),
      database.prepare('DELETE FROM movement'),
      database.prepare('DELETE FROM session'),
      database.prepare('DELETE FROM scan_day'),
      database.prepare('DELETE FROM meta'),
    ]);

    const days = Math.min(1095, Math.max(30, Number(testEnv.BENCH_DAYS ?? '365')));
    const to = '2026-11-18';
    const from = addDays(to, -(days - 1));
    const responses: Array<{ date: string; response: ReturnType<typeof syntheticDay> }> = [];

    const seedStart = performance.now();
    for (let i = 0; i < days; i += 1) {
      const date = addDays(from, i);
      const response = syntheticDay(date, { anomaly: i > 0 && i % 37 === 0 });
      responses.push({ date, response });
      await replaceDay(testEnv, date, response);
    }
    const seedMs = performance.now() - seedStart;

    const coldStart = performance.now();
    await trainingOverview(testEnv, { from, to, includeToday: true });
    const coldMs = performance.now() - coldStart;
    const warmStart = performance.now();
    const overview = await trainingOverview(testEnv, { from, to, includeToday: true });
    const warmMs = performance.now() - warmStart;
    const monthly = await queryTraining(testEnv, {
      from,
      to,
      groupBy: 'month',
      fields: ['sessions', 'sets', 'volume_kg', 'duration_min'],
      limit: 120,
    });

    const perCallDays = 2;
    const calls = Math.ceil(days / perCallDays);
    let v01Bytes = 0;
    let v01Tokens = 0;
    for (let i = 0; i < responses.length; i += perCallDays) {
      const chunk = responses.slice(i, i + perCallDays);
      const payload = {
        from: chunk[0]!.date,
        to: chunk.at(-1)!.date,
        status: 'ok',
        days: chunk.map((day) => summarizeDay(day.date, day.response)),
        daysRecorded: chunk.filter((day) => (day.response.trains ?? []).length > 0).length,
        daysRequested: chunk.length,
        deferred: [],
        pending: [],
        meta: {
          upstream: { readRateLimitSeconds: 15, cached: false },
          limits: chunk[0]!.response.limits,
        },
      };
      const measured = measure(payload);
      v01Bytes += measured.bytes;
      v01Tokens += measured.tokens;
    }

    const overviewMeasure = measure(overview);
    const monthlyMeasure = measure(monthly);
    const result = {
      generatedAt: new Date().toISOString(),
      dataset: {
        days,
        from,
        to,
        seedMs: Math.round(seedMs),
        note: 'Synthetic; no real training data.',
      },
      v01: {
        approach: 'xunji_list_training_days, 2 uncached days per call',
        calls,
        upstreamReads: days,
        serializedBytes: v01Bytes,
        tokensEstimate: v01Tokens,
        estimatedLatencySeconds: Math.round(days * 0.25 + calls * 0.05),
        perCallPayloadBytes: Math.round(v01Bytes / calls),
      },
      v02: {
        overviewToolCalls: 1,
        overview: { ...overviewMeasure, coldMs: Math.round(coldMs), warmMs: Math.round(warmMs) },
        monthlyQuery: { ...monthlyMeasure, rows: monthly.rowCount, coldMs: null },
        indexQueries: 3,
      },
      comparison: {
        callReduction: `${calls}x -> 1`,
        byteReduction: `${(v01Bytes / overviewMeasure.bytes).toFixed(1)}x smaller`,
        coverage: overview.coverage.complete ? 'complete' : 'partial',
      },
    };
    console.log(`BENCH_RESULT ${JSON.stringify(result)}`);
  });
});
