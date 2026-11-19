/**
 * Normalization: upstream Xunji training payloads -> compact, agent-friendly
 * structures.
 *
 * Design rules:
 * - Never echo raw upstream payloads; they can be large and carry free text.
 * - "No training recorded" is a successful, empty result — not an error.
 * - Aggregates are computed here so an agent does not have to re-derive them
 *   from sets, and so the token cost of a range query stays bounded.
 */

import type {
  DaySummary,
  NormalizedMovement,
  NormalizedSet,
  NormalizedTrain,
  XunjiMovement,
  XunjiSet,
  XunjiTrain,
  XunjiTrainResponse,
} from '../types';

function toNumber(value: string | number | undefined | null): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parses the vendor's `note` string, which is either plain text or JSON-ish. */
function parseNote(note: string | undefined): {
  text?: string;
  calories?: number | null;
  color?: string | null;
  heartRate?: { avg?: number; max?: number; min?: number; samples?: number };
} {
  if (!note) return {};
  const trimmed = note.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const hr = parsed.heartRate;
      return {
        text:
          typeof parsed.text === 'string' && parsed.text.trim() ? parsed.text.trim() : undefined,
        calories: toNumber(parsed.calorie as number | undefined),
        color: typeof parsed.trainColor === 'string' ? parsed.trainColor : null,
        heartRate:
          hr && typeof hr === 'object'
            ? {
                avg:
                  toNumber((hr as Record<string, unknown>).avg as number | undefined) ?? undefined,
                max:
                  toNumber((hr as Record<string, unknown>).max as number | undefined) ?? undefined,
                min:
                  toNumber((hr as Record<string, unknown>).min as number | undefined) ?? undefined,
                samples:
                  toNumber((hr as Record<string, unknown>).count as number | undefined) ??
                  undefined,
              }
            : undefined,
      };
    } catch {
      // Fall through: treat as opaque text.
    }
  }
  // Upstream also writes `calorie:290` style fragments.
  const calorieMatch = /calorie[:=]\s*(\d+(?:\.\d+)?)/i.exec(trimmed);
  return {
    text: trimmed,
    calories: calorieMatch ? Number(calorieMatch[1]) : null,
    color: null,
  };
}

function normalizeSet(set: XunjiSet, fallbackIndex: number): NormalizedSet {
  const setTypeRaw = set.setType ?? '';
  const normalized: NormalizedSet = {
    index: set.index ?? fallbackIndex,
    done: set.done === true,
  };
  if (setTypeRaw.includes('热')) normalized.setType = 'warmup';
  else if (setTypeRaw) normalized.setType = 'work';

  const weight = toNumber(set.weight);
  if (weight !== null) normalized.weight = weight;
  if (set.unit) normalized.weightUnit = set.unit;
  const leftWeight = toNumber(set.leftWeight);
  if (leftWeight !== null) normalized.leftWeight = leftWeight;
  const reps = toNumber(set.reps);
  if (reps !== null) normalized.reps = reps;
  if (set.selfWeight === true) normalized.selfWeight = true;
  const duration = toNumber(set.time);
  if (duration !== null && duration > 0) normalized.durationSeconds = duration;
  const rpe = toNumber(set.rpe);
  if (rpe !== null) normalized.rpe = rpe;
  if (set.metrics) {
    normalized.metrics = set.metrics;
    const distance = toNumber(set.metrics.distance);
    if (distance !== null) normalized.distanceMeters = distance;
  }
  if (set.note) normalized.note = set.note;
  if (set.comment) normalized.comment = set.comment;
  return normalized;
}

/** Effective load for volume math: explicit weight, or 0 when bodyweight. */
function effectiveWeight(set: NormalizedSet): number {
  if (set.weight !== null && set.weight !== undefined) return set.weight;
  if (set.selfWeight) return 0;
  return 0;
}

function normalizeMovement(movement: XunjiMovement, fallbackIndex: number): NormalizedMovement {
  const rawSets = movement.sets ?? [];
  const sets = rawSets.map((set, i) => normalizeSet(set, i + 1));

  let totalReps = 0;
  let totalVolumeKg = 0;
  let completed = 0;
  let topSetWeightKg: number | null = null;

  for (const set of sets) {
    if (set.done) completed += 1;
    if (set.reps) totalReps += set.reps;
    if (set.done) {
      totalVolumeKg += effectiveWeight(set) * (set.reps ?? 0);
      if (set.weight !== null && set.weight !== undefined) {
        topSetWeightKg =
          topSetWeightKg === null ? set.weight : Math.max(topSetWeightKg, set.weight);
      }
    }
  }

  const normalized: NormalizedMovement = {
    index: movement.index ?? fallbackIndex,
    name: movement.name,
    totalSets: sets.length,
    completedSets: completed,
    totalReps,
    totalVolumeKg: Math.round(totalVolumeKg * 100) / 100,
    topSetWeightKg,
    sets,
  };
  if (movement.type) normalized.category = movement.type;
  if (movement.exetype) normalized.exerciseType = movement.exetype;
  if (typeof movement.restTime === 'number') normalized.restSeconds = movement.restTime;
  if (typeof movement.warn_restTime === 'number' && movement.warn_restTime > 0) {
    normalized.warmupRestSeconds = movement.warn_restTime;
  }
  if (movement.singleSide === true) normalized.singleSide = true;
  if (movement.note) normalized.note = movement.note;
  if (movement.cardio === true) normalized.cardio = true;
  if (movement.recordPreset) normalized.recordPreset = movement.recordPreset;
  if (movement.metrics) normalized.metrics = movement.metrics;

  const supersetItems = rawSets.flatMap((set) => set.items ?? []);
  if (supersetItems.length > 0) {
    normalized.superset = supersetItems.map((item) => ({
      name: item.name ?? 'unknown',
      sets: item.set ? [normalizeSet(item.set, 1)] : [],
    }));
  }

  return normalized;
}

export function normalizeTrain(
  train: XunjiTrain,
  options: { includeNotes?: boolean } = {},
): NormalizedTrain {
  const movements = (train.movements ?? []).map((m, i) => normalizeMovement(m, i + 1));
  const note = parseNote(train.note);

  let completedSetCount = 0;
  let totalVolumeKg = 0;
  for (const movement of movements) {
    completedSetCount += movement.completedSets;
    totalVolumeKg += movement.totalVolumeKg;
  }

  const startMs = train.started_at ?? train.start;
  const endMs = train.ended_at ?? train.end;

  const result: NormalizedTrain = {
    localid: train.localid,
    date: train.datestr,
    movements,
    movementCount: movements.length,
    completedSetCount,
    totalVolumeKg: Math.round(totalVolumeKg * 100) / 100,
    hasHeartRate: Boolean(train.heartRate),
    truncated: train.truncated === true,
  };
  if (train.title) result.title = train.title;
  if (options.includeNotes && note.text) result.noteText = note.text;
  if (note.calories !== undefined && note.calories !== null) result.calories = note.calories;
  if (note.color) result.color = note.color;
  if (typeof startMs === 'number') result.startMs = startMs;
  if (typeof endMs === 'number') result.endMs = endMs;
  if (typeof startMs === 'number' && typeof endMs === 'number' && endMs > startMs) {
    result.durationMinutes = Math.round(((endMs - startMs) / 60000) * 10) / 10;
  }
  if (train.heartRate) result.heartRate = extractHeartRate(train.heartRate);
  return result;
}

function extractHeartRate(source: Record<string, unknown>): {
  avg?: number;
  max?: number;
  min?: number;
  samples?: number;
} {
  const out: { avg?: number; max?: number; min?: number; samples?: number } = {};
  const avg = toNumber(source.avg as number | undefined);
  const max = toNumber(source.max as number | undefined);
  const min = toNumber(source.min as number | undefined);
  const samples = toNumber(source.count as number | undefined);
  if (avg !== null) out.avg = avg;
  if (max !== null) out.max = max;
  if (min !== null) out.min = min;
  if (samples !== null) out.samples = samples;
  return out;
}

/** Summarizes a day without exposing per-set detail. */
export function summarizeDay(datestr: string, response: XunjiTrainResponse): DaySummary {
  const trains = response.trains ?? [];
  let movementCount = 0;
  let completedSetCount = 0;
  let totalVolumeKg = 0;
  let durationMinutes = 0;
  let hasHeartRate = false;

  for (const train of trains) {
    const normalized = normalizeTrain(train);
    movementCount += normalized.movementCount;
    completedSetCount += normalized.completedSetCount;
    totalVolumeKg += normalized.totalVolumeKg;
    durationMinutes += normalized.durationMinutes ?? 0;
    hasHeartRate = hasHeartRate || normalized.hasHeartRate;
  }

  const summary: DaySummary = {
    date: datestr,
    trainCount: trains.length,
    movementCount,
    completedSetCount,
    totalVolumeKg: Math.round(totalVolumeKg * 100) / 100,
    durationMinutes: Math.round(durationMinutes * 10) / 10,
    hasHeartRate,
    localids: trains.map((t) => t.localid),
    truncated: response.truncated === true || trains.some((t) => t.truncated === true),
  };
  const only = trains.length === 1 ? trains[0] : undefined;
  if (only?.title) summary.title = only.title;
  return summary;
}

/**
 * Flattens every movement occurrence across a set of trains into per-name
 * history rows. Used for "how has this lift progressed".
 */
export interface MovementHistoryRow {
  date: string;
  localid: number;
  trainTitle?: string;
  movementIndex: number;
  movementName: string;
  completedSets: number;
  totalSets: number;
  topSetWeightKg: number | null;
  totalReps: number;
  totalVolumeKg: number;
  bestSet?: { weight: number | null; reps: number | null; rpe?: number | null };
}

export function movementHistory(
  trains: XunjiTrain[],
  movementNames: string[],
): MovementHistoryRow[] {
  const wanted = new Set(movementNames.map((n) => n.trim()).filter(Boolean));
  const rows: MovementHistoryRow[] = [];

  for (const train of trains) {
    const normalized = normalizeTrain(train);
    for (const movement of normalized.movements) {
      if (!wanted.has(movement.name)) continue;

      let bestSet: MovementHistoryRow['bestSet'];
      for (const set of movement.sets) {
        if (!set.done) continue;
        const weight = set.weight ?? null;
        if (bestSet === undefined || (weight ?? 0) > (bestSet.weight ?? 0)) {
          bestSet = { weight, reps: set.reps ?? null };
        }
      }
      if (bestSet && movement.sets.some((s) => s.done && s.rpe)) {
        const withRpe = movement.sets.filter((s) => s.done && s.rpe).at(-1);
        if (withRpe) bestSet.rpe = withRpe.rpe ?? null;
      }

      const row: MovementHistoryRow = {
        date: normalized.date,
        localid: normalized.localid,
        movementIndex: movement.index,
        movementName: movement.name,
        completedSets: movement.completedSets,
        totalSets: movement.totalSets,
        topSetWeightKg: movement.topSetWeightKg,
        totalReps: movement.totalReps,
        totalVolumeKg: movement.totalVolumeKg,
      };
      if (normalized.title) row.trainTitle = normalized.title;
      if (bestSet) row.bestSet = bestSet;
      rows.push(row);
    }
  }

  rows.sort((a, b) =>
    a.date === b.date ? a.movementIndex - b.movementIndex : a.date < b.date ? -1 : 1,
  );
  return rows;
}

/** Aggregate statistics over a window of days. */
export interface TrainingStats {
  from: string;
  to: string;
  daysWithTraining: number;
  daysRequested: number;
  trainCount: number;
  movementCount: number;
  completedSetCount: number;
  totalVolumeKg: number;
  totalDurationMinutes: number;
  averageSessionMinutes: number | null;
  /** Sessions grouped by weekday (1 = Monday ... 7 = Sunday). */
  byWeekday: Record<string, number>;
  /** Most-trained movements by completed sets, descending. */
  topMovements: Array<{
    name: string;
    occurrences: number;
    completedSets: number;
    totalVolumeKg: number;
  }>;
  /** Titles seen, for quick shape recognition. */
  titles: string[];
}

export function aggregateStats(
  days: Array<{ date: string; response: XunjiTrainResponse }>,
): TrainingStats {
  let trainCount = 0;
  let movementCount = 0;
  let completedSetCount = 0;
  let totalVolumeKg = 0;
  let totalDurationMinutes = 0;
  let daysWithTraining = 0;

  const byWeekday: Record<string, number> = {
    Mon: 0,
    Tue: 0,
    Wed: 0,
    Thu: 0,
    Fri: 0,
    Sat: 0,
    Sun: 0,
  };
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const movementTotals = new Map<
    string,
    { occurrences: number; completedSets: number; totalVolumeKg: number }
  >();
  const titles = new Set<string>();

  for (const day of days) {
    const trains = day.response.trains ?? [];
    if (trains.length > 0) daysWithTraining += 1;
    for (const train of trains) {
      trainCount += 1;
      const normalized = normalizeTrain(train);
      movementCount += normalized.movementCount;
      completedSetCount += normalized.completedSetCount;
      totalVolumeKg += normalized.totalVolumeKg;
      totalDurationMinutes += normalized.durationMinutes ?? 0;
      if (normalized.title) titles.add(normalized.title);

      const parsedDate = new Date(`${day.date}T00:00:00Z`);
      if (!Number.isNaN(parsedDate.getTime())) {
        const name = dayNames[parsedDate.getUTCDay()];
        if (name) byWeekday[name] = (byWeekday[name] ?? 0) + 1;
      }

      for (const movement of normalized.movements) {
        const current = movementTotals.get(movement.name) ?? {
          occurrences: 0,
          completedSets: 0,
          totalVolumeKg: 0,
        };
        current.occurrences += 1;
        current.completedSets += movement.completedSets;
        current.totalVolumeKg += movement.totalVolumeKg;
        movementTotals.set(movement.name, current);
      }
    }
  }

  const topMovements = [...movementTotals.entries()]
    .map(([name, value]) => ({
      name,
      occurrences: value.occurrences,
      completedSets: value.completedSets,
      totalVolumeKg: Math.round(value.totalVolumeKg * 100) / 100,
    }))
    .sort((a, b) => b.completedSets - a.completedSets || b.totalVolumeKg - a.totalVolumeKg)
    .slice(0, 15);

  return {
    from: days[0]?.date ?? '',
    to: days.at(-1)?.date ?? '',
    daysWithTraining,
    daysRequested: days.length,
    trainCount,
    movementCount,
    completedSetCount,
    totalVolumeKg: Math.round(totalVolumeKg * 100) / 100,
    totalDurationMinutes: Math.round(totalDurationMinutes * 10) / 10,
    averageSessionMinutes:
      trainCount > 0 ? Math.round((totalDurationMinutes / trainCount) * 10) / 10 : null,
    byWeekday,
    topMovements,
    titles: [...titles].slice(0, 20),
  };
}
