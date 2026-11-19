import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { getCoverage, markScanResult, replaceDay, setHistoryStart } from '../../src/index/store';
import { movementProgress, queryTraining, trainingOverview } from '../../src/index/query';
import type { Env, XunjiTrainResponse } from '../../src/types';
import { syntheticDay, syntheticRange } from '../helpers/synthetic';

const testEnv = env as unknown as Env;
const database = testEnv.DB!;

async function clear(): Promise<void> {
  await database.batch([
    database.prepare('DELETE FROM set_fact'),
    database.prepare('DELETE FROM movement'),
    database.prepare('DELETE FROM session'),
    database.prepare('DELETE FROM scan_day'),
    database.prepare('DELETE FROM meta'),
  ]);
}

async function seedRange(
  from: string,
  to: string,
  options: { anomalyEvery?: number } = {},
): Promise<void> {
  for (const day of syntheticRange(from, to, options)) {
    await replaceDay(testEnv, day.date, day.response);
  }
}

beforeEach(async () => {
  await clear();
});

describe('index day replacement', () => {
  it('excludes warm-ups, keeps bodyweight sets, and never doubles unilateral weight', async () => {
    const date = '2026-03-02';
    await replaceDay(testEnv, date, syntheticDay(date, { rest: false }));

    const result = await queryTraining(testEnv, {
      from: date,
      to: date,
      groupBy: 'total',
      fields: ['sets', 'reps', 'volume_kg', 'bodyweight_sets', 'est_1rm_kg'],
    });

    expect(result.totals.sets).toBe(6);
    expect(result.totals.bodyweight_sets).toBe(1);
    // 60x8 twice + 20x10 unilateral (not doubled); bodyweight contributes 0 kg.
    expect(result.totals.volume_kg).toBe(2232);
  });

  it('replaces a day transactionally so removed source records disappear', async () => {
    const date = '2026-03-03';
    const full = syntheticDay(date, { rest: false });
    await replaceDay(testEnv, date, full);

    const oneMovement: XunjiTrainResponse = {
      ...full,
      trains: [
        {
          ...full.trains![0]!,
          movements: [
            {
              index: 1,
              name: '杠铃卧推',
              type: '胸',
              sets: [{ index: 1, done: true, weight: '50', unit: 'kg', reps: '5' }],
            },
          ],
        },
      ],
    };
    await replaceDay(testEnv, date, oneMovement);

    const result = await queryTraining(testEnv, {
      from: date,
      to: date,
      groupBy: 'movement',
      fields: ['sets', 'volume_kg'],
      topK: 10,
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]![1]).toBe(1);
    expect(result.rows[0]![2]).toBe(250);
  });

  it('tracks empty days separately from missing and failed days', async () => {
    const date = '2026-03-04';
    await replaceDay(testEnv, date, syntheticDay(date, { rest: true }));
    await markScanResult(testEnv, '2026-03-05', {
      status: 'pending',
      retryAfterMs: 30_000,
      error: 'vendor vendor_pacing',
    });
    await markScanResult(testEnv, '2026-03-06', {
      status: 'error',
      retryAfterMs: 60_000,
      error: 'network',
    });

    const coverage = await getCoverage(testEnv, '2026-03-01', '2026-03-07');
    expect(coverage.days).toBe(7);
    expect(coverage.scannedDays).toBe(1);
    expect(coverage.emptyDays).toBe(1);
    expect(coverage.pendingDays).toBe(5);
    expect(coverage.errorDays).toBe(1);
    expect(coverage.complete).toBe(false);
    expect(coverage.earliestRecord).toBeNull();
  });
});

describe('aggregation', () => {
  beforeEach(async () => {
    await seedRange('2026-01-01', '2026-03-31', { anomalyEvery: 17 });
    await setHistoryStart(testEnv, '2026-01-01');
  });

  it('groups a quarter in one query and reports complete coverage', async () => {
    const result = await queryTraining(testEnv, {
      from: '2026-01-01',
      to: '2026-03-31',
      groupBy: 'month',
      fields: ['sessions', 'training_days', 'sets', 'volume_kg', 'duration_min'],
      includeToday: true,
    });
    expect(result.rows).toHaveLength(3);
    expect(result.coverage.complete).toBe(true);
    expect(result.totals.sessions).toBeGreaterThan(30);
    expect(result.totals.volume_kg).toBeGreaterThan(0);
    expect(result.rows.every((row) => Number(row[3]) > 0)).toBe(true);
  });

  it('filters by exact movement and muscle group without inventing categories', async () => {
    const bench = await queryTraining(testEnv, {
      from: '2026-01-01',
      to: '2026-03-31',
      movements: ['杠铃卧推'],
      groupBy: 'total',
      fields: ['sessions', 'sets', 'volume_kg'],
    });
    const chest = await queryTraining(testEnv, {
      from: '2026-01-01',
      to: '2026-03-31',
      muscleGroups: ['胸'],
      groupBy: 'total',
      fields: ['sessions', 'sets', 'volume_kg'],
    });
    expect(bench.totals.sessions).toBe(chest.totals.sessions);
    expect(bench.unmatchedMovements).toEqual([]);

    const missing = await queryTraining(testEnv, {
      from: '2026-01-01',
      to: '2026-03-31',
      movements: ['不存在的动作'],
      groupBy: 'total',
    });
    expect(missing.unmatchedMovements).toEqual(['不存在的动作']);
    expect(missing.totals.sessions).toBe(0);
  });

  it('excludes anomalous durations from the average but reports them', async () => {
    const overview = await trainingOverview(testEnv, { from: '2026-01-01', to: '2026-03-31' });
    expect(overview.kpis.durationAnomalies).toBeGreaterThan(0);
    expect(overview.kpis.avgSessionMinutes).toBeGreaterThan(60);
  });

  it('returns a ranked topK list for movements', async () => {
    const result = await queryTraining(testEnv, {
      from: '2026-01-01',
      to: '2026-03-31',
      groupBy: 'movement',
      fields: ['sets', 'volume_kg'],
      topK: 2,
      orderBy: 'volume_kg',
    });
    expect(result.rows).toHaveLength(2);
    expect(Number(result.rows[0]![2])).toBeGreaterThanOrEqual(Number(result.rows[1]![2]));
  });

  it('computes PRs and a bounded Epley estimate', async () => {
    const progress = await movementProgress(testEnv, {
      movements: ['杠铃卧推'],
      from: '2026-01-01',
      to: '2026-03-31',
    });
    const bench = progress.movements[0]!;
    expect(bench.sessions).toBeGreaterThan(20);
    expect(bench.bestWeightKg?.weight).toBeGreaterThan(60);
    expect(bench.bestEst1rmKg?.value).toBeGreaterThan(bench.bestWeightKg!.weight);
    expect(bench.prCount).toBeGreaterThan(0);
    expect(progress.definitions.est_1rm_kg).toContain('Epley');
  });
});
