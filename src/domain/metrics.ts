/**
 * Derived metrics with explicit, defensible definitions.
 *
 * These rules exist so the index never turns "no evidence" into a number:
 * bodyweight is not a load, warm-ups are not working sets, unilateral weight is
 * not doubled, and estimated 1RM is only produced inside its valid range.
 */

export const METRIC_DEFINITIONS = {
  volume_kg:
    'Sum of weight x reps over completed working sets in kg. Bodyweight sets contribute 0 kg; unilateral sets are not doubled.',
  sets: 'Completed working sets. Warm-up sets (setType contains 热) are excluded unless includeWarmups is true.',
  reps: 'Reps on completed working sets.',
  sessions: 'Distinct sessions (localid) with at least one set matching the filters.',
  training_days: 'Distinct calendar dates with at least one session.',
  duration_min:
    'Session duration from start/end timestamps. Sessions shorter than 1 minute or longer than 6 hours are flagged and excluded from averages.',
  best_weight_kg: 'Heaviest completed working set in the bucket.',
  est_1rm_kg:
    'Epley estimate w x (1 + reps/30), completed working sets with 1-12 reps only. A trend indicator, not a tested max.',
  bodyweight_sets:
    'Completed working sets with selfWeight=true; their load is not counted in volume_kg.',
} as const;

export type MetricKey = keyof typeof METRIC_DEFINITIONS;

export const METRIC_KEYS = Object.keys(METRIC_DEFINITIONS) as MetricKey[];

export const UNIT_BY_METRIC: Record<string, string> = {
  volume_kg: 'kg',
  best_weight_kg: 'kg',
  est_1rm_kg: 'kg',
  duration_min: 'min',
};

/** The vendor `unit` seen in practice is kg; anything else is not summed. */
export function isKilogram(unit: string | undefined | null): boolean {
  if (!unit) return true;
  return unit.trim().toLowerCase() === 'kg';
}

export function isWarmupSet(setType: string | undefined): boolean {
  return typeof setType === 'string' && setType.includes('热');
}

/** Epley, bounded to the range where it is commonly used. */
export function estimateOneRepMax(weight: number | null, reps: number | null): number | null {
  if (weight === null || reps === null) return null;
  if (weight <= 0 || reps < 1 || reps > 12) return null;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

export function volumeKg(
  weight: number | null,
  reps: number | null,
  unit: string | null,
): number | null {
  if (weight === null || reps === null || !isKilogram(unit)) return null;
  return Math.round(weight * reps * 100) / 100;
}

/** Sessions outside this range are flagged rather than silently averaged in. */
export function isDurationAnomaly(durationSeconds: number | null): boolean {
  if (durationSeconds === null) return false;
  return durationSeconds < 60 || durationSeconds > 6 * 60 * 60;
}
