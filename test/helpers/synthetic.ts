/** Deterministic synthetic history. No real training values are used. */

import type { XunjiMovement, XunjiSet, XunjiTrainResponse } from '../../src/types';

const MOVEMENTS = [
  { name: '杠铃卧推', type: '胸', base: 60, reps: 8 },
  { name: '杠铃深蹲', type: '腿', base: 80, reps: 6 },
  { name: '杠铃硬拉', type: '背', base: 100, reps: 5 },
  { name: '杠铃划船', type: '背', base: 50, reps: 10 },
] as const;

function localidFor(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
}

function set(index: number, weight: number, reps: number, extra: Partial<XunjiSet> = {}): XunjiSet {
  return {
    index,
    done: true,
    weight: String(weight),
    unit: 'kg',
    reps: String(reps),
    time: 0,
    timeLabel: '',
    selfWeight: false,
    ...extra,
  };
}

export function syntheticDay(
  date: string,
  options: { rest?: boolean; anomaly?: boolean; variant?: number } = {},
): XunjiTrainResponse {
  const dayIndex = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const rest = options.rest ?? (weekday === 0 || weekday === 3);
  const localid = localidFor(date);
  const variant = options.variant ?? 0;

  if (rest) {
    return { schema: 'train_open_api_v2', datestr: date, truncated: false, trains: [] };
  }

  const epoch = Date.parse('2026-01-01T00:00:00Z') / 86_400_000;
  const progress = Math.floor((dayIndex - epoch) / 28) * 2;
  const movements: XunjiMovement[] = MOVEMENTS.slice(0, 2 + (variant % 3)).map(
    (movement, index) => {
      const workingWeight = movement.base + progress + variant;
      const sets: XunjiSet[] = [
        set(1, Math.round(workingWeight * 0.5), 10, { setType: '热' }),
        set(2, workingWeight, movement.reps, { rpe: '8' }),
        set(3, workingWeight, movement.reps, { rpe: '9' }),
      ];
      return {
        index: index + 1,
        name: movement.name,
        type: movement.type,
        exetype: 'weight',
        sets,
        truncated: false,
        note: '',
        singleSide: false,
        restTime: 120,
        warn_restTime: 60,
      };
    },
  );

  // Bodyweight work: counted as sets/reps, zero kg volume.
  movements.push({
    index: movements.length + 1,
    name: '引体向上',
    type: '背',
    exetype: 'weight',
    sets: [set(1, 0, 8, { weight: '', selfWeight: true })],
    truncated: false,
    note: '',
    singleSide: false,
  });

  // Unilateral work: weight is not doubled.
  movements.push({
    index: movements.length + 1,
    name: '哑铃保加利亚蹲',
    type: '腿',
    exetype: 'weight',
    sets: [set(1, 20, 10, { leftWeight: '20' })],
    truncated: false,
    note: '',
    singleSide: true,
  });

  const durationMinutes = options.anomaly ? 0.5 : 70 + (variant % 5) * 5;
  const start = Date.parse(`${date}T10:00:00Z`);

  return {
    schema: 'train_open_api_v2',
    datestr: date,
    limits: {
      maxTrainsPerDay: 4,
      maxMovesPerTrain: 40,
      maxSetsPerMove: 60,
      maxWriteMovesPerTrain: 15,
      maxWriteSetsPerMove: 20,
      maxPayloadBytes: 131072,
      maxResponseBytes: 196608,
      readRateLimitSeconds: 15,
      readRateLimitSecondsLight: 15,
      readRateLimitSecondsFull: 30,
      writeRateLimitSeconds: 45,
    },
    truncated: false,
    trains: [
      {
        localid,
        datestr: date,
        title: `合成·${MOVEMENTS[variant % MOVEMENTS.length]!.type}`,
        note: 'calorie:250',
        start,
        end: start + durationMinutes * 60_000,
        movements,
        truncated: false,
      },
    ],
  };
}

export function syntheticRange(
  from: string,
  to: string,
  options: { anomalyEvery?: number; variant?: number } = {},
): Array<{ date: string; response: XunjiTrainResponse }> {
  const out: Array<{ date: string; response: XunjiTrainResponse }> = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  let index = 0;
  for (let cursor = start; cursor <= end; cursor += 86_400_000) {
    const date = new Date(cursor).toISOString().slice(0, 10);
    index += 1;
    out.push({
      date,
      response: syntheticDay(date, {
        variant: (options.variant ?? 0) + index,
        anomaly: Boolean(options.anomalyEvery && index % options.anomalyEvery === 0),
      }),
    });
  }
  return out;
}
