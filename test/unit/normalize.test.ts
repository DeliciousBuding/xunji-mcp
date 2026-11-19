import { describe, expect, it } from 'vitest';

import {
  aggregateStats,
  movementHistory,
  normalizeTrain,
  summarizeDay,
} from '../../src/domain/normalize';
import type { XunjiTrainResponse } from '../../src/types';
import fixture from '../fixtures/train-day.synthetic.json';

const response = fixture as unknown as XunjiTrainResponse;

describe('normalizeTrain', () => {
  it('computes volume from completed sets only, treating bodyweight as zero load', () => {
    const train = response.trains![0]!;
    const normalized = normalizeTrain(train);

    expect(normalized.movementCount).toBe(2);
    // warmup 20*10 + working 60*8; the unchecked set must not count.
    expect(normalized.totalVolumeKg).toBe(680);
    expect(normalized.completedSetCount).toBe(3);
    expect(normalized.durationMinutes).toBeCloseTo(89.1, 1);
  });

  it('keeps unchecked sets in full mode and drops them in summary mode', () => {
    const train = response.trains![0]!;
    const full = normalizeTrain(train);
    const summary = normalizeTrain(train);
    const filtered = {
      ...summary,
      movements: summary.movements.map((movement) => ({
        ...movement,
        sets: movement.sets.filter((set) => set.done),
      })),
    };

    expect(full.movements[0]!.sets).toHaveLength(3);
    expect(filtered.movements[0]!.sets).toHaveLength(2);
  });

  it('marks warmup sets and preserves RPE when the vendor sends it', () => {
    const normalized = normalizeTrain(response.trains![0]!);
    expect(normalized.movements[0]!.sets[0]!.setType).toBeUndefined();
    expect(normalized.movements[0]!.sets[1]!.rpe).toBe(8);
    expect(normalized.movements[0]!.restSeconds).toBe(90);
    expect(normalized.movements[0]!.warmupRestSeconds).toBe(45);
  });

  it('parses the vendor calorie fragment without leaking the raw note', () => {
    const normalized = normalizeTrain(response.trains![0]!);
    expect(normalized.calories).toBe(290);
    expect(normalized.noteText).toBeUndefined();
  });
});

describe('summarizeDay', () => {
  it('reports an empty day as a successful zero row', () => {
    const summary = summarizeDay('2026-11-14', {
      datestr: '2026-11-14',
      trains: [],
      truncated: false,
    });
    expect(summary.trainCount).toBe(0);
    expect(summary.totalVolumeKg).toBe(0);
    expect(summary.localids).toEqual([]);
  });
});

describe('movementHistory', () => {
  it('returns one row per matching occurrence', () => {
    const rows = movementHistory([response.trains![0]!], ['杠铃卧推', '深蹲']);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.movementName).toBe('杠铃卧推');
    expect(rows[0]!.topSetWeightKg).toBe(60);
    expect(rows[0]!.completedSets).toBe(2);
  });
});

describe('aggregateStats', () => {
  it('aggregates a window and counts days without training', () => {
    const stats = aggregateStats([
      { date: '2026-11-16', response: { trains: [] } },
      { date: '2026-11-17', response },
    ]);
    expect(stats.daysRequested).toBe(2);
    expect(stats.daysWithTraining).toBe(1);
    expect(stats.trainCount).toBe(1);
    expect(stats.completedSetCount).toBe(3);
    expect(stats.totalVolumeKg).toBe(680);
    expect(stats.topMovements[0]!.name).toBe('杠铃卧推');
    expect(stats.byWeekday.Tue).toBe(1);
  });
});
