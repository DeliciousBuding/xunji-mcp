/**
 * Training analytics over the derived index.
 *
 * The query surface is deliberately finite: enums instead of a query language,
 * SQL built from a fixed set of expressions, and parameter binding everywhere
 * else. Aggregation happens in SQLite, not in the model's context window.
 */

import { addDays, todayInXunjiZone } from '../domain/date';
import { METRIC_DEFINITIONS, type MetricKey, UNIT_BY_METRIC } from '../domain/metrics';
import { enumerateDates } from '../service/day-read';
import type { Env } from '../types';
import { db, getCoverage, getMeta, type Coverage } from './store';

export type GroupBy = 'total' | 'day' | 'week' | 'month' | 'year' | 'movement' | 'muscle_group';
export type OrderBy = 'volume_kg' | 'sets' | 'reps' | 'est_1rm_kg' | 'sessions';
export type RangePreset = 'all_time' | 'last_7d' | 'last_30d' | 'last_90d' | 'last_365d' | 'ytd';

export interface TrainingQueryInput {
  from?: string;
  to?: string;
  preset?: RangePreset;
  movements?: string[];
  muscleGroups?: string[];
  groupBy?: GroupBy;
  fields?: MetricKey[];
  includeWarmups?: boolean;
  includeToday?: boolean;
  topK?: number;
  orderBy?: OrderBy;
  limit?: number;
  includeSets?: boolean;
}

export interface QueryRange {
  from: string;
  to: string;
  preset: RangePreset | 'custom';
  /** True when `from` is the configured history start rather than a chosen date. */
  allTimeConfigured: boolean;
}

const MAX_SPAN_DAYS = 366 * 20;
const MAX_LIMIT = 400;
const MAX_TOP_K = 50;
const MAX_SET_ROWS = 400;

export async function resolveRange(env: Env, input: TrainingQueryInput): Promise<QueryRange> {
  const today = todayInXunjiZone();
  const endDefault = input.includeToday ? today : addDays(today, -1);
  const preset = input.preset ?? (input.from || input.to ? 'custom' : 'all_time');

  if (preset === 'custom') {
    const from = input.from ?? (await earliestIndexed(env)) ?? addDays(endDefault, -30);
    const to = input.to ?? endDefault;
    return { from, to, preset, allTimeConfigured: false };
  }

  if (preset === 'all_time') {
    const historyStart = await getMeta<string>(env, 'history_start');
    const from =
      input.from ?? historyStart ?? (await earliestIndexed(env)) ?? addDays(endDefault, -365);
    const to = input.to ?? endDefault;
    return { from, to, preset, allTimeConfigured: Boolean(historyStart) };
  }

  const days =
    preset === 'last_7d' ? 7 : preset === 'last_30d' ? 30 : preset === 'last_90d' ? 90 : 365;
  if (preset === 'ytd') {
    return {
      from: `${today.slice(0, 4)}-01-01`,
      to: input.to ?? endDefault,
      preset,
      allTimeConfigured: false,
    };
  }
  return {
    from: addDays(endDefault, -(days - 1)),
    to: input.to ?? endDefault,
    preset,
    allTimeConfigured: false,
  };
}

async function earliestIndexed(env: Env): Promise<string | null> {
  const database = db(env);
  if (!database) return null;
  const row = await database
    .prepare(`SELECT MIN(datestr) AS earliest FROM scan_day WHERE status IN ('complete','empty')`)
    .first<{ earliest: string | null }>();
  return row?.earliest ?? null;
}

function bucketExpression(groupBy: GroupBy): string {
  switch (groupBy) {
    case 'day':
      return 'datestr';
    case 'week':
      // Monday-based week start; no locale dependence.
      return "date(datestr, '-' || ((cast(strftime('%w', datestr) as integer) + 6) % 7) || ' days')";
    case 'month':
      return 'substr(datestr, 1, 7)';
    case 'year':
      return 'substr(datestr, 1, 4)';
    case 'movement':
      return 'movement_name';
    case 'muscle_group':
      return "coalesce(nullif(muscle_group, ''), 'uncategorized')";
    default:
      return "'total'";
  }
}

const DEFAULT_FIELDS: Record<GroupBy, MetricKey[]> = {
  total: [
    'sessions',
    'training_days',
    'sets',
    'reps',
    'volume_kg',
    'duration_min',
    'best_weight_kg',
    'est_1rm_kg',
  ],
  day: ['sessions', 'sets', 'reps', 'volume_kg', 'duration_min'],
  week: ['sessions', 'training_days', 'sets', 'volume_kg', 'duration_min'],
  month: ['sessions', 'training_days', 'sets', 'volume_kg', 'duration_min'],
  year: ['sessions', 'training_days', 'sets', 'volume_kg', 'duration_min'],
  movement: ['sessions', 'sets', 'reps', 'volume_kg', 'best_weight_kg', 'est_1rm_kg'],
  muscle_group: ['sessions', 'sets', 'reps', 'volume_kg'],
};

function metricSelect(fields: MetricKey[]): string {
  const expressions: Record<MetricKey, string> = {
    sessions: 'COUNT(DISTINCT f.localid)',
    training_days: 'COUNT(DISTINCT f.datestr)',
    sets: 'SUM(1)',
    reps: 'SUM(COALESCE(f.reps, 0))',
    volume_kg: 'ROUND(SUM(COALESCE(f.volume_kg, 0)), 2)',
    duration_min: 'NULL',
    best_weight_kg: 'ROUND(MAX(f.weight), 2)',
    est_1rm_kg: 'ROUND(MAX(f.est_1rm_kg), 1)',
    bodyweight_sets: 'SUM(CASE WHEN f.self_weight = 1 THEN 1 ELSE 0 END)',
  };
  return fields.map((field) => `${expressions[field]} AS ${field}`).join(', ');
}

export interface TrainingQueryResult {
  status: 'ok';
  dataset: 'training';
  query: Record<string, unknown>;
  range: QueryRange;
  coverage: Coverage;
  columns: string[];
  rows: Array<Array<string | number | null>>;
  rowCount: number;
  truncated: boolean;
  omittedRows: number;
  totals: Record<string, number | null>;
  units: Record<string, string>;
  definitions: Record<string, string>;
  unmatchedMovements: string[];
  source: { authority: 'Xunji'; index: 'derived'; version: 1 };
  meta: { generatedAt: number; setsReturned?: number };
}

export async function queryTraining(
  env: Env,
  input: TrainingQueryInput,
): Promise<TrainingQueryResult> {
  const database = db(env);
  if (!database) throw new IndexUnavailableError();
  const range = await resolveRange(env, input);
  const dates = enumerateDates(range.from, range.to);
  if (dates.length === 0) throw new QueryError('invalid_range', '`to` must be on or after `from`.');
  if (dates.length > MAX_SPAN_DAYS) {
    throw new QueryError('range_too_large', `At most ${MAX_SPAN_DAYS} days per query.`);
  }

  const groupBy = input.groupBy ?? 'month';
  const fields = (input.fields?.length ? input.fields : DEFAULT_FIELDS[groupBy]).filter((field) =>
    Object.hasOwn(METRIC_DEFINITIONS, field),
  );
  if (fields.length === 0)
    throw new QueryError('invalid_fields', 'Choose at least one supported metric.');
  if (fields.includes('duration_min') && (groupBy === 'movement' || groupBy === 'muscle_group')) {
    throw new QueryError(
      'invalid_combination',
      'duration_min is a session metric; group by time or total.',
    );
  }

  const where = ['f.datestr BETWEEN ? AND ?', 'f.done = 1'];
  const params: Array<string | number> = [range.from, range.to];
  if (!input.includeWarmups) where.push('f.is_warmup = 0');
  if (input.movements?.length) {
    where.push(`f.movement_name IN (${input.movements.map(() => '?').join(',')})`);
    params.push(...input.movements);
  }
  if (input.muscleGroups?.length) {
    where.push(
      `coalesce(nullif(f.muscle_group, ''), 'uncategorized') IN (${input.muscleGroups.map(() => '?').join(',')})`,
    );
    params.push(...input.muscleGroups);
  }
  const filterParams = params.slice(2);
  const whereSql = where.join(' AND ');
  const bucket = bucketExpression(groupBy);

  const limit = Math.min(MAX_LIMIT, Math.max(1, input.limit ?? (groupBy === 'total' ? 1 : 120)));
  const topK = Math.min(MAX_TOP_K, Math.max(1, input.topK ?? 12));
  const orderBy =
    input.orderBy ??
    (groupBy === 'movement' || groupBy === 'muscle_group' ? 'volume_kg' : 'sessions');
  const isRanked = groupBy === 'movement' || groupBy === 'muscle_group';
  if (isRanked && !fields.includes(orderBy)) fields.push(orderBy);

  const orderSql = isRanked ? `${orderBy} DESC, bucket ASC` : 'bucket ASC';
  const limitSql = isRanked ? `LIMIT ${topK}` : groupBy === 'total' ? 'LIMIT 1' : '';

  const rowsResult = await database
    .prepare(
      `SELECT ${bucket} AS bucket, ${metricSelect(fields)}
       FROM set_fact f
       WHERE ${whereSql}
       GROUP BY bucket
       ORDER BY ${orderSql}
       ${limitSql}`,
    )
    .bind(...params)
    .all<Record<string, string | number | null>>();

  let rows = rowsResult.results ?? [];
  let truncated = false;
  let omittedRows = 0;
  if (!isRanked && groupBy !== 'total' && rows.length > limit) {
    omittedRows = rows.length - limit;
    rows = rows.slice(-limit);
    truncated = true;
  }

  const totalsResult = await database
    .prepare(`SELECT ${metricSelect(fields)} FROM set_fact f WHERE ${whereSql}`)
    .bind(...params)
    .first<Record<string, number | null>>();

  const totals: Record<string, number | null> = {};
  for (const field of fields) totals[field] = roundValue(totalsResult?.[field] ?? null);

  if (fields.includes('duration_min')) {
    const duration = await durationTotals(
      env,
      range.from,
      range.to,
      whereSql,
      filterParams,
      groupBy,
      isRanked,
    );
    const byBucket = new Map(duration.rows.map((row) => [String(row.bucket), row.duration_min]));
    for (const row of rows) {
      row.duration_min = byBucket.get(String(row.bucket)) ?? 0;
    }
    totals.duration_min = duration.total;
  }

  let unmatchedMovements: string[] = [];
  if (input.movements?.length) {
    const seen = await database
      .prepare(
        `SELECT DISTINCT movement_name FROM set_fact
         WHERE datestr BETWEEN ? AND ? AND movement_name IN (${input.movements.map(() => '?').join(',')})`,
      )
      .bind(range.from, range.to, ...input.movements)
      .all<{ movement_name: string }>();
    const found = new Set((seen.results ?? []).map((row) => row.movement_name));
    unmatchedMovements = input.movements.filter((name) => !found.has(name));
  }

  const columns = ['bucket', ...fields];
  const values = rows.map((row) => [
    String(row.bucket),
    ...fields.map((field) => roundValue(row[field] ?? null)),
  ]);
  const definitions: Record<string, string> = {};
  for (const field of fields) definitions[field] = METRIC_DEFINITIONS[field];

  const result: TrainingQueryResult = {
    status: 'ok',
    dataset: 'training',
    query: {
      groupBy,
      fields,
      includeWarmups: input.includeWarmups === true,
      movements: input.movements ?? [],
      muscleGroups: input.muscleGroups ?? [],
      topK: isRanked ? topK : undefined,
      orderBy: isRanked ? orderBy : undefined,
      limit: isRanked || groupBy === 'total' ? undefined : limit,
    },
    range,
    coverage: await getCoverage(env, range.from, range.to),
    columns,
    rows: values,
    rowCount: values.length,
    truncated,
    omittedRows,
    totals,
    units: Object.fromEntries(
      fields
        .filter((field) => UNIT_BY_METRIC[field])
        .map((field) => [field, UNIT_BY_METRIC[field]!]),
    ),
    definitions,
    unmatchedMovements,
    source: { authority: 'Xunji', index: 'derived', version: 1 },
    meta: { generatedAt: Date.now() },
  };

  if (input.includeSets) {
    const sets = await database
      .prepare(
        `SELECT f.datestr, f.localid, f.movement_name, f.muscle_group, f.set_index,
                f.is_warmup, f.weight, f.unit, f.reps, f.self_weight, f.single_side,
                f.rpe, f.volume_kg, f.est_1rm_kg
         FROM set_fact f
         WHERE ${whereSql}
         ORDER BY f.datestr DESC, f.localid DESC, f.movement_name ASC, f.set_index ASC
         LIMIT ?`,
      )
      .bind(...params, MAX_SET_ROWS)
      .all<Record<string, string | number | null>>();
    const setColumns = [
      'datestr',
      'localid',
      'movement_name',
      'muscle_group',
      'set_index',
      'is_warmup',
      'weight',
      'unit',
      'reps',
      'self_weight',
      'single_side',
      'rpe',
      'volume_kg',
      'est_1rm_kg',
    ];
    result.meta.setsReturned = sets.results?.length ?? 0;
    (result as TrainingQueryResult & { setColumns: string[]; setRows: unknown[][] }).setColumns =
      setColumns;
    (result as TrainingQueryResult & { setColumns: string[]; setRows: unknown[][] }).setRows = (
      sets.results ?? []
    ).map((row) => setColumns.map((column) => row[column] ?? null));
  }

  return result;
}

async function durationTotals(
  env: Env,
  from: string,
  to: string,
  whereSql: string,
  filterParams: Array<string | number>,
  groupBy: GroupBy,
  isRanked: boolean,
): Promise<{ rows: Array<{ bucket: string; duration_min: number }>; total: number }> {
  const database = db(env);
  if (!database) return { rows: [], total: 0 };
  const bucketSession = bucketExpression(groupBy).replaceAll('datestr', 's.datestr');
  const subquery = `SELECT DISTINCT f.localid FROM set_fact f WHERE ${whereSql}`;

  if (isRanked) {
    const row = await database
      .prepare(
        `SELECT ROUND(SUM(s.duration_s) / 60.0, 1) AS duration_min
         FROM session s WHERE s.duration_anomaly = 0 AND s.datestr BETWEEN ? AND ?
           AND s.localid IN (${subquery})`,
      )
      .bind(from, to, from, to, ...filterParams)
      .first<{ duration_min: number | null }>();
    return { rows: [], total: roundValue(row?.duration_min ?? 0) as number };
  }

  const rows = await database
    .prepare(
      `SELECT ${bucketSession} AS bucket, ROUND(SUM(s.duration_s) / 60.0, 1) AS duration_min
       FROM session s
       WHERE s.duration_anomaly = 0 AND s.datestr BETWEEN ? AND ?
         AND s.localid IN (${subquery})
       GROUP BY bucket ORDER BY bucket ASC`,
    )
    .bind(from, to, from, to, ...filterParams)
    .all<{ bucket: string; duration_min: number | null }>();
  const total = await database
    .prepare(
      `SELECT ROUND(SUM(s.duration_s) / 60.0, 1) AS duration_min
       FROM session s WHERE s.duration_anomaly = 0 AND s.datestr BETWEEN ? AND ?
         AND s.localid IN (${subquery})`,
    )
    .bind(from, to, from, to, ...filterParams)
    .first<{ duration_min: number | null }>();
  return {
    rows: (rows.results ?? []).map((row) => ({
      bucket: row.bucket,
      duration_min: Number(row.duration_min ?? 0),
    })),
    total: roundValue(total?.duration_min ?? 0) as number,
  };
}

function roundValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100) / 100;
}

export interface OverviewResult {
  status: 'ok';
  range: QueryRange;
  coverage: Coverage;
  kpis: {
    sessions: number;
    trainingDays: number;
    sets: number;
    volumeKg: number;
    durationHours: number | null;
    avgSessionMinutes: number | null;
    durationAnomalies: number;
    bodyweightSets: number;
  };
  monthly: { columns: string[]; rows: Array<Array<string | number | null>> };
  recent: { last4WeeksVolumeKg: number; previous4WeeksVolumeKg: number; changePct: number | null };
  topMovements: { columns: string[]; rows: Array<Array<string | number | null>> };
  source: { authority: 'Xunji'; index: 'derived'; version: 1 };
  meta: { generatedAt: number };
}

export async function trainingOverview(
  env: Env,
  input: TrainingQueryInput = {},
): Promise<OverviewResult> {
  const query = await queryTraining(env, {
    ...input,
    groupBy: 'total',
    fields: [
      'sessions',
      'training_days',
      'sets',
      'reps',
      'volume_kg',
      'duration_min',
      'bodyweight_sets',
    ],
  });
  const monthly = await queryTraining(env, {
    ...input,
    groupBy: 'month',
    fields: ['sessions', 'sets', 'volume_kg', 'duration_min'],
    limit: 12,
  });
  const top = await queryTraining(env, {
    ...input,
    groupBy: 'movement',
    fields: ['sessions', 'sets', 'volume_kg', 'est_1rm_kg'],
    topK: 8,
  });

  const database = db(env);
  let durationAnomalies = 0;
  let avgSessionMinutes: number | null = null;
  if (database) {
    const anomalies = await database
      .prepare(
        'SELECT COUNT(*) AS n FROM session WHERE datestr BETWEEN ? AND ? AND duration_anomaly = 1',
      )
      .bind(query.range.from, query.range.to)
      .first<{ n: number }>();
    durationAnomalies = Number(anomalies?.n ?? 0);
    const sessionsWithDuration = await database
      .prepare(
        `SELECT COUNT(*) AS n, ROUND(SUM(duration_s) / 60.0, 1) AS minutes
         FROM session WHERE datestr BETWEEN ? AND ? AND duration_anomaly = 0 AND duration_s IS NOT NULL`,
      )
      .bind(query.range.from, query.range.to)
      .first<{ n: number; minutes: number | null }>();
    const n = Number(sessionsWithDuration?.n ?? 0);
    if (n > 0) avgSessionMinutes = Math.round(((sessionsWithDuration?.minutes ?? 0) / n) * 10) / 10;
  }

  const end = query.range.to;
  const last4Start = addDays(end, -27);
  const prev4End = addDays(last4Start, -1);
  const prev4Start = addDays(prev4End, -27);
  const recent = [
    Number(
      (
        await queryTraining(env, {
          ...input,
          from: last4Start,
          to: end,
          preset: undefined,
          groupBy: 'total',
          fields: ['volume_kg'],
        })
      ).totals.volume_kg ?? 0,
    ),
    Number(
      (
        await queryTraining(env, {
          ...input,
          from: prev4Start,
          to: prev4End,
          preset: undefined,
          groupBy: 'total',
          fields: ['volume_kg'],
        })
      ).totals.volume_kg ?? 0,
    ),
  ];

  const result: OverviewResult = {
    status: 'ok',
    range: query.range,
    coverage: query.coverage,
    kpis: {
      sessions: Number(query.totals.sessions ?? 0),
      trainingDays: Number(query.totals.training_days ?? 0),
      sets: Number(query.totals.sets ?? 0),
      volumeKg: Number(query.totals.volume_kg ?? 0),
      durationHours:
        query.totals.duration_min === null || query.totals.duration_min === undefined
          ? null
          : Math.round((Number(query.totals.duration_min) / 60) * 10) / 10,
      avgSessionMinutes,
      durationAnomalies,
      bodyweightSets: Number(query.totals.bodyweight_sets ?? 0),
    },
    monthly: { columns: monthly.columns, rows: monthly.rows },
    recent: {
      last4WeeksVolumeKg: recent[0] ?? 0,
      previous4WeeksVolumeKg: recent[1] ?? 0,
      changePct:
        recent[1] && recent[1] > 0
          ? Math.round(((recent[0]! - recent[1]) / recent[1]) * 1000) / 10
          : null,
    },
    topMovements: { columns: top.columns, rows: top.rows },
    source: { authority: 'Xunji', index: 'derived', version: 1 },
    meta: { generatedAt: Date.now() },
  };
  return result;
}

export interface MovementProgressResult {
  status: 'ok';
  range: QueryRange;
  coverage: Coverage;
  movements: Array<{
    name: string;
    sessions: number;
    firstDate: string | null;
    lastDate: string | null;
    bestWeightKg: { weight: number; reps: number; date: string } | null;
    bestEst1rmKg: { value: number; weight: number; reps: number; date: string } | null;
    prCount: number;
    prTimeline: Array<{ date: string; weight: number; reps: number; est1rmKg: number }>;
    monthly: { columns: string[]; rows: Array<Array<string | number | null>> };
    plateau: { flagged: boolean; reason: string | null };
  }>;
  missingMovements: string[];
  definitions: Record<string, string>;
  source: { authority: 'Xunji'; index: 'derived'; version: 1 };
  meta: { generatedAt: number };
}

export async function movementProgress(
  env: Env,
  input: {
    movements: string[];
    from?: string;
    to?: string;
    preset?: RangePreset;
    maxPrRows?: number;
  },
): Promise<MovementProgressResult> {
  const database = db(env);
  if (!database) throw new IndexUnavailableError();
  const range = await resolveRange(env, {
    from: input.from,
    to: input.to,
    preset: input.preset,
    includeToday: true,
  });
  const dates = enumerateDates(range.from, range.to);
  if (dates.length === 0) throw new QueryError('invalid_range', '`to` must be on or after `from`.');
  if (dates.length > MAX_SPAN_DAYS)
    throw new QueryError('range_too_large', `At most ${MAX_SPAN_DAYS} days per query.`);

  const placeholders = input.movements.map(() => '?').join(',');
  const rows = await database
    .prepare(
      `SELECT datestr, localid, movement_name, set_index, weight, reps, est_1rm_kg
       FROM set_fact
       WHERE datestr BETWEEN ? AND ? AND movement_name IN (${placeholders})
         AND done = 1 AND is_warmup = 0 AND weight IS NOT NULL AND reps IS NOT NULL
       ORDER BY movement_name ASC, datestr ASC, set_index ASC`,
    )
    .bind(range.from, range.to, ...input.movements)
    .all<{
      datestr: string;
      localid: number;
      movement_name: string;
      set_index: number;
      weight: number;
      reps: number;
      est_1rm_kg: number | null;
    }>();

  const maxPrRows = Math.min(20, Math.max(1, input.maxPrRows ?? 12));
  const groups = new Map<string, typeof rows.results>();
  for (const row of rows.results ?? []) {
    const list = groups.get(row.movement_name) ?? [];
    list.push(row);
    groups.set(row.movement_name, list);
  }

  const movements = await Promise.all(
    input.movements
      .filter((name) => groups.has(name))
      .map(async (name) => {
        const list = groups.get(name)!;
        let bestWeight: { weight: number; reps: number; date: string } | null = null;
        let bestEst: { value: number; weight: number; reps: number; date: string } | null = null;
        let runningMax = 0;
        let prCount = 0;
        const prTimeline: Array<{ date: string; weight: number; reps: number; est1rmKg: number }> =
          [];
        const sessions = new Set<number>();
        let firstDate: string | null = null;
        let lastDate: string | null = null;

        for (const row of list) {
          sessions.add(row.localid);
          if (!firstDate) firstDate = row.datestr;
          lastDate = row.datestr;
          if (
            !bestWeight ||
            row.weight > bestWeight.weight ||
            (row.weight === bestWeight.weight && row.reps > bestWeight.reps)
          ) {
            bestWeight = { weight: row.weight, reps: row.reps, date: row.datestr };
          }
          if (row.est_1rm_kg !== null && row.est_1rm_kg !== undefined) {
            const value = Number(row.est_1rm_kg);
            if (!bestEst || value > bestEst.value) {
              bestEst = { value, weight: row.weight, reps: row.reps, date: row.datestr };
            }
            if (value > runningMax + 0.05) {
              runningMax = value;
              prCount += 1;
              if (prTimeline.length < maxPrRows) {
                prTimeline.push({
                  date: row.datestr,
                  weight: row.weight,
                  reps: row.reps,
                  est1rmKg: value,
                });
              }
            }
          }
        }

        const monthly = await monthlyForMovement(database, name, range);
        return {
          name,
          sessions: sessions.size,
          firstDate,
          lastDate,
          bestWeightKg: bestWeight,
          bestEst1rmKg: bestEst,
          prCount,
          prTimeline,
          monthly,
          plateau: plateauFor(list),
        };
      }),
  );

  return {
    status: 'ok',
    range,
    coverage: await getCoverage(env, range.from, range.to),
    movements,
    missingMovements: input.movements.filter((name) => !groups.has(name)),
    definitions: {
      best_weight_kg: METRIC_DEFINITIONS.best_weight_kg,
      est_1rm_kg: METRIC_DEFINITIONS.est_1rm_kg,
      plateau:
        'Flagged when the best Epley estimate in each of the last 5 sessions has not exceeded the prior 5-session best by 1%, over at least 28 days. A heuristic, not a verdict.',
    },
    source: { authority: 'Xunji', index: 'derived', version: 1 },
    meta: { generatedAt: Date.now() },
  };
}

async function monthlyForMovement(
  database: D1Database,
  name: string,
  range: QueryRange,
): Promise<{ columns: string[]; rows: Array<Array<string | number | null>> }> {
  const result = await database
    .prepare(
      `SELECT substr(datestr, 1, 7) AS bucket,
              ROUND(SUM(volume_kg), 2) AS volume_kg,
              COUNT(*) AS sets,
              ROUND(MAX(est_1rm_kg), 1) AS est_1rm_kg
       FROM set_fact
       WHERE datestr BETWEEN ? AND ? AND movement_name = ?
         AND done = 1 AND is_warmup = 0
       GROUP BY bucket ORDER BY bucket ASC`,
    )
    .bind(range.from, range.to, name)
    .all<{ bucket: string; volume_kg: number; sets: number; est_1rm_kg: number | null }>();
  return {
    columns: ['bucket', 'volume_kg', 'sets', 'est_1rm_kg'],
    rows: (result.results ?? []).map((row) => [
      row.bucket,
      row.volume_kg,
      row.sets,
      row.est_1rm_kg,
    ]),
  };
}

function plateauFor(list: Array<{ datestr: string; localid: number; est_1rm_kg: number | null }>): {
  flagged: boolean;
  reason: string | null;
} {
  const sessionBest = new Map<number, { date: string; value: number }>();
  for (const row of list) {
    if (row.est_1rm_kg === null) continue;
    const current = sessionBest.get(row.localid);
    if (!current || row.est_1rm_kg > current.value) {
      sessionBest.set(row.localid, { date: row.datestr, value: row.est_1rm_kg });
    }
  }
  const ordered = [...sessionBest.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (ordered.length < 10) return { flagged: false, reason: null };
  const last5 = ordered.slice(-5);
  const prior = ordered.slice(-10, -5);
  const priorBest = Math.max(...prior.map((entry) => entry.value));
  const lastBest = Math.max(...last5.map((entry) => entry.value));
  const spanDays = Math.round(
    (Date.parse(`${last5.at(-1)!.date}T00:00:00Z`) - Date.parse(`${last5[0]!.date}T00:00:00Z`)) /
      86_400_000,
  );
  if (lastBest <= priorBest * 1.01 && spanDays >= 28) {
    return {
      flagged: true,
      reason: `Best estimate did not improve by 1% across the last 5 sessions over ${spanDays} days.`,
    };
  }
  return { flagged: false, reason: null };
}

export class QueryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'QueryError';
  }
}

export class IndexUnavailableError extends Error {
  constructor() {
    super(
      'This deployment has no derived index. Ask the operator to enable D1 and run a backfill.',
    );
    this.name = 'IndexUnavailableError';
  }
}
