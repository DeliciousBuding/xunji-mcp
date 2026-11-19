/**
 * D1-backed derived index.
 *
 * Xunji remains the source of truth: every row here is a normalized copy of an
 * upstream field or a documented derived metric. The index exists because the
 * vendor has no range/bulk endpoint and paces one day at a time; without it an
 * all-history question would need hundreds of tool round trips.
 */

import { enumerateDates } from '../service/day-read';
import type { Env, XunjiTrainResponse } from '../types';
import { utcDay } from '../kv-budget';
import { estimateOneRepMax, isDurationAnomaly, isWarmupSet, volumeKg } from '../domain/metrics';

export type ScanStatus = 'complete' | 'empty' | 'error' | 'pending';

export interface Coverage {
  /** Configured or discovered start of the indexed window. */
  from: string;
  to: string;
  days: number;
  scannedDays: number;
  emptyDays: number;
  errorDays: number;
  pendingDays: number;
  missingDays: number;
  /** True only when every day in [from,to] is fetched and error-free. */
  complete: boolean;
  /** Earliest contiguous verified day from the configured history start. */
  earliestVerified: string | null;
  /** Earliest date with an indexed session; never a claim about earlier data. */
  earliestRecord: string | null;
  latestScanned: string | null;
  lastRefresh: number | null;
  pending: string[];
  errors: Array<{ date: string; error: string; attempts: number }>;
}

export interface IndexMeta {
  historyStart?: string;
  scanStartedAt?: number;
  scanPaused?: boolean;
  lastScanAt?: number;
  indexVersion?: number;
}

export function db(env: Env): D1Database | null {
  return env.DB ?? null;
}

export async function getMeta<T = string>(env: Env, key: string): Promise<T | null> {
  const database = db(env);
  if (!database) return null;
  const row = await database
    .prepare('SELECT value FROM meta WHERE key = ?')
    .bind(key)
    .first<{ value: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return row.value as unknown as T;
  }
}

export async function setMeta(env: Env, key: string, value: unknown): Promise<void> {
  const database = db(env);
  if (!database) return;
  await database
    .prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    .bind(key, JSON.stringify(value))
    .run();
}

export async function setHistoryStart(env: Env, date: string): Promise<void> {
  const current = await getMeta<string>(env, 'history_start');
  if (!current || date < current) await setMeta(env, 'history_start', date);
}

export async function setScanPaused(env: Env, paused: boolean): Promise<void> {
  await setMeta(env, 'scan_paused', paused);
}

export async function isScanPaused(env: Env): Promise<boolean> {
  return (await getMeta<boolean>(env, 'scan_paused')) === true;
}

/** Marks a date pending unless it already has any state. */
export async function enqueueRange(
  env: Env,
  from: string,
  to: string,
  onlyMissing = true,
): Promise<number> {
  const database = db(env);
  if (!database) return 0;
  const dates = enumerateDates(from, to);
  if (dates.length === 0) return 0;
  const verb = onlyMissing ? 'INSERT OR IGNORE' : 'INSERT OR REPLACE';
  let written = 0;
  for (let i = 0; i < dates.length; i += 80) {
    const chunk = dates.slice(i, i + 80);
    const statements = chunk.map((date) =>
      database
        .prepare(`${verb} INTO scan_day (datestr, status, attempts) VALUES (?, 'pending', 0)`)
        .bind(date),
    );
    await database.batch(statements);
    written += chunk.length;
  }
  await setMeta(env, 'scan_started_at', Date.now());
  return written;
}

/** Forces a refresh by clearing the fetched state for the range. */
export async function enqueueRefresh(env: Env, from: string, to: string): Promise<number> {
  const database = db(env);
  if (!database) return 0;
  const dates = enumerateDates(from, to);
  if (dates.length === 0) return 0;
  for (let i = 0; i < dates.length; i += 80) {
    const chunk = dates.slice(i, i + 80);
    const statements = chunk.map((date) =>
      database
        .prepare(
          `INSERT INTO scan_day (datestr, status, attempts, next_attempt_at)
           VALUES (?, 'pending', 0, NULL)
           ON CONFLICT(datestr) DO UPDATE SET status = 'pending', attempts = 0, next_attempt_at = NULL, last_error = NULL`,
        )
        .bind(date),
    );
    await database.batch(statements);
  }
  return dates.length;
}

export async function dueScanDates(env: Env, limit: number, now = Date.now()): Promise<string[]> {
  const database = db(env);
  if (!database) return [];
  const rows = await database
    .prepare(
      `SELECT datestr FROM scan_day
       WHERE status IN ('pending', 'error')
         AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
       ORDER BY datestr ASC
       LIMIT ?`,
    )
    .bind(now, limit)
    .all<{ datestr: string }>();
  return (rows.results ?? []).map((row) => row.datestr);
}

export async function scanStatusCounts(
  env: Env,
): Promise<{ pending: number; error: number; complete: number; empty: number; total: number }> {
  const database = db(env);
  if (!database) return { pending: 0, error: 0, complete: 0, empty: 0, total: 0 };
  const row = await database
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error,
         SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) AS complete,
         SUM(CASE WHEN status = 'empty' THEN 1 ELSE 0 END) AS empty,
         COUNT(*) AS total
       FROM scan_day`,
    )
    .first<Record<string, number>>();
  return {
    pending: Number(row?.pending ?? 0),
    error: Number(row?.error ?? 0),
    complete: Number(row?.complete ?? 0),
    empty: Number(row?.empty ?? 0),
    total: Number(row?.total ?? 0),
  };
}

export async function markScanResult(
  env: Env,
  date: string,
  result:
    | { status: 'complete'; trains: number; movements: number; fingerprint: string }
    | { status: 'empty' }
    | { status: 'pending'; retryAfterMs: number; error: string }
    | { status: 'error'; error: string; retryAfterMs: number },
): Promise<void> {
  const database = db(env);
  if (!database) return;
  const now = Date.now();
  if (result.status === 'complete' || result.status === 'empty') {
    await database
      .prepare(
        `INSERT INTO scan_day (datestr, status, trains_count, movements_count, fingerprint, fetched_at, attempts, next_attempt_at, last_error)
         VALUES (?, ?, ?, ?, ?, ?, 0, NULL, NULL)
         ON CONFLICT(datestr) DO UPDATE SET
           status = excluded.status,
           trains_count = excluded.trains_count,
           movements_count = excluded.movements_count,
           fingerprint = excluded.fingerprint,
           fetched_at = excluded.fetched_at,
           attempts = 0,
           next_attempt_at = NULL,
           last_error = NULL`,
      )
      .bind(
        date,
        result.status,
        result.status === 'complete' ? result.trains : 0,
        result.status === 'complete' ? result.movements : 0,
        result.status === 'complete' ? result.fingerprint : null,
        now,
      )
      .run();
    return;
  }

  const row = await database
    .prepare('SELECT attempts FROM scan_day WHERE datestr = ?')
    .bind(date)
    .first<{ attempts: number }>();
  const attempts = Number(row?.attempts ?? 0) + 1;
  const status = result.status === 'pending' ? 'pending' : 'error';
  await database
    .prepare(
      `INSERT INTO scan_day (datestr, status, attempts, next_attempt_at, last_error)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(datestr) DO UPDATE SET
         status = excluded.status, attempts = excluded.attempts,
         next_attempt_at = excluded.next_attempt_at, last_error = excluded.last_error`,
    )
    .bind(
      date,
      status,
      attempts,
      now + Math.max(1_000, result.retryAfterMs),
      result.error.slice(0, 200),
    )
    .run();
}

async function fingerprint(value: unknown): Promise<string> {
  const text = JSON.stringify(value);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

/** Replaces one day transactionally: source edits and deletions are reflected. */
export async function replaceDay(
  env: Env,
  date: string,
  response: XunjiTrainResponse,
): Promise<void> {
  const database = db(env);
  if (!database) return;
  const trains = response.trains ?? [];
  const statements: D1PreparedStatement[] = [
    database.prepare('DELETE FROM set_fact WHERE datestr = ?').bind(date),
    database.prepare('DELETE FROM movement WHERE datestr = ?').bind(date),
    database.prepare('DELETE FROM session WHERE datestr = ?').bind(date),
  ];
  const now = Date.now();
  let movementCount = 0;

  for (const train of trains) {
    const durationSeconds =
      typeof train.start === 'number' && typeof train.end === 'number'
        ? Math.max(0, Math.round((train.end - train.start) / 1000))
        : null;
    const note = train.note ?? '';
    const calorie =
      /calorie["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)/i.exec(note)?.[1] ??
      /calorie[:=]\s*(\d+)/i.exec(note)?.[1];
    statements.push(
      database
        .prepare(
          `INSERT INTO session (localid, datestr, title, calories, start_ms, end_ms, duration_s, has_heart_rate, duration_anomaly, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          train.localid,
          date,
          train.title ?? null,
          calorie ? Number(calorie) : null,
          train.start ?? null,
          train.end ?? null,
          durationSeconds,
          train.heartRate ? 1 : 0,
          isDurationAnomaly(durationSeconds) ? 1 : 0,
          now,
        ),
    );

    for (const movement of train.movements ?? []) {
      movementCount += 1;
      const key = `${train.localid}:${movement.index ?? movementCount}`;
      statements.push(
        database
          .prepare(
            `INSERT INTO movement (key, localid, datestr, movement_index, name, muscle_group, exetype, single_side, rest_s, warmup_rest_s, cardio, record_preset)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            key,
            train.localid,
            date,
            movement.index ?? movementCount,
            movement.name,
            movement.type || null,
            movement.exetype || null,
            movement.singleSide ? 1 : 0,
            movement.restTime ?? null,
            movement.warn_restTime ?? null,
            movement.cardio ? 1 : 0,
            movement.recordPreset ?? null,
          ),
      );

      for (const set of movement.sets ?? []) {
        if (set.items && set.items.length > 0) {
          // Superset rounds: index each child as its own movement fact so
          // aggregates do not silently drop the work.
          for (const [childIndex, item] of set.items.entries()) {
            const child = item.set;
            if (!child) continue;
            const childKey = `${key}:r${set.index ?? 0}:${childIndex}`;
            statements.push(
              database
                .prepare(
                  `INSERT INTO movement (key, localid, datestr, movement_index, name, muscle_group, exetype, single_side, rest_s, warmup_rest_s, cardio, record_preset)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, NULL)`,
                )
                .bind(
                  childKey,
                  train.localid,
                  date,
                  movement.index ?? movementCount,
                  item.name ?? movement.name,
                  movement.type || null,
                  movement.exetype || null,
                  movement.singleSide ? 1 : 0,
                ),
            );
            statements.push(
              setStatement(database, {
                localid: train.localid,
                date,
                movementKey: childKey,
                movementName: item.name ?? movement.name,
                muscleGroup: movement.type || null,
                setIndex: childIndex,
                raw: child,
                singleSide: movement.singleSide === true,
              }),
            );
          }
          continue;
        }

        statements.push(
          setStatement(database, {
            localid: train.localid,
            date,
            movementKey: key,
            movementName: movement.name,
            muscleGroup: movement.type || null,
            setIndex: set.index ?? 0,
            raw: set,
            singleSide: movement.singleSide === true,
          }),
        );
      }
    }
  }

  for (let i = 0; i < statements.length; i += 80) {
    await database.batch(statements.slice(i, i + 80));
  }

  await markScanResult(env, date, {
    status: trains.length > 0 ? 'complete' : 'empty',
    trains: trains.length,
    movements: movementCount,
    fingerprint: await fingerprint(response),
  });
  await setMeta(env, 'last_scan_at', now);
}

function setStatement(
  database: D1Database,
  input: {
    localid: number;
    date: string;
    movementKey: string;
    movementName: string;
    muscleGroup: string | null;
    setIndex: number;
    raw: {
      index?: number;
      done?: boolean;
      weight?: string;
      unit?: string;
      reps?: string;
      selfWeight?: boolean;
      leftWeight?: string;
      rpe?: string;
      setType?: string;
    };
    singleSide: boolean;
  },
): D1PreparedStatement {
  const weight = numberOrNull(input.raw.weight);
  const reps = numberOrNull(input.raw.reps);
  const unit = input.raw.unit ?? null;
  return database
    .prepare(
      `INSERT OR REPLACE INTO set_fact
       (localid, datestr, movement_key, movement_name, muscle_group, set_index, done, is_warmup, weight, unit, reps, self_weight, single_side, left_weight, rpe, volume_kg, est_1rm_kg)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.localid,
      input.date,
      input.movementKey,
      input.movementName,
      input.muscleGroup,
      input.setIndex,
      input.raw.done === true ? 1 : 0,
      isWarmupSet(input.raw.setType) ? 1 : 0,
      weight,
      unit,
      reps,
      input.raw.selfWeight === true ? 1 : 0,
      input.singleSide ? 1 : 0,
      numberOrNull(input.raw.leftWeight),
      numberOrNull(input.raw.rpe),
      volumeKg(weight, reps, unit),
      estimateOneRepMax(weight, reps),
    );
}

function numberOrNull(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getCoverage(env: Env, from: string, to: string): Promise<Coverage> {
  const database = db(env);
  const dates = enumerateDates(from, to);
  const empty: Coverage = {
    from,
    to,
    days: dates.length,
    scannedDays: 0,
    emptyDays: 0,
    errorDays: 0,
    pendingDays: 0,
    missingDays: dates.length,
    complete: false,
    earliestVerified: null,
    earliestRecord: null,
    latestScanned: null,
    lastRefresh: null,
    pending: [],
    errors: [],
  };
  if (!database || dates.length === 0) return empty;

  const rows = await database
    .prepare(
      'SELECT datestr, status, last_error, attempts FROM scan_day WHERE datestr BETWEEN ? AND ?',
    )
    .bind(from, to)
    .all<{ datestr: string; status: ScanStatus; last_error: string | null; attempts: number }>();
  const byDate = new Map((rows.results ?? []).map((row) => [row.datestr, row]));

  let scannedDays = 0;
  let emptyDays = 0;
  let errorDays = 0;
  let pendingDays = 0;
  const pending: string[] = [];
  const errors: Coverage['errors'] = [];
  let latestScanned: string | null = null;

  for (const date of dates) {
    const row = byDate.get(date);
    if (!row) {
      pendingDays += 1;
      pending.push(date);
      continue;
    }
    if (row.status === 'complete' || row.status === 'empty') {
      scannedDays += 1;
      if (row.status === 'empty') emptyDays += 1;
      if (!latestScanned || date > latestScanned) latestScanned = date;
    } else if (row.status === 'error') {
      errorDays += 1;
      errors.push({ date, error: row.last_error ?? 'unknown', attempts: row.attempts });
    } else {
      pendingDays += 1;
      pending.push(date);
    }
  }

  const earliestRow = await database
    .prepare(
      `SELECT MIN(datestr) AS earliest FROM scan_day
       WHERE datestr BETWEEN ? AND ? AND status IN ('complete','empty')`,
    )
    .bind(from, to)
    .first<{ earliest: string | null }>();
  const earliestRecordRow = await database
    .prepare('SELECT MIN(datestr) AS earliest FROM session WHERE datestr BETWEEN ? AND ?')
    .bind(from, to)
    .first<{ earliest: string | null }>();
  const lastScan = await getMeta<number>(env, 'last_scan_at');

  const missingDays = dates.length - scannedDays - errorDays;
  return {
    ...empty,
    scannedDays,
    emptyDays,
    errorDays,
    pendingDays,
    missingDays,
    complete: scannedDays === dates.length && errorDays === 0,
    earliestVerified: earliestRow?.earliest ?? null,
    earliestRecord: earliestRecordRow?.earliest ?? null,
    latestScanned,
    lastRefresh: typeof lastScan === 'number' ? lastScan : null,
    pending: pending.slice(0, 60),
    errors: errors.slice(0, 20),
  };
}

/** Earliest contiguous verified day starting at the configured history start. */
export async function contiguousVerifiedFrom(
  env: Env,
  historyStart: string,
  to: string,
): Promise<string | null> {
  const database = db(env);
  if (!database) return null;
  const rows = await database
    .prepare(
      `SELECT datestr, status FROM scan_day
       WHERE datestr BETWEEN ? AND ? ORDER BY datestr ASC`,
    )
    .bind(historyStart, to)
    .all<{ datestr: string; status: ScanStatus }>();
  const byDate = new Map((rows.results ?? []).map((row) => [row.datestr, row.status]));
  let last: string | null = null;
  for (const date of enumerateDates(historyStart, to)) {
    const status = byDate.get(date);
    if (status !== 'complete' && status !== 'empty') break;
    last = date;
  }
  return last;
}

export function scanDailyLimit(env: Env): number {
  const parsed = Number(env.SCAN_DAILY_LIMIT ?? '100');
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 100;
}

export async function scanBudgetStatus(
  env: Env,
  day = utcDay(),
): Promise<{ day: string; used: number; budget: number; remaining: number }> {
  const budget = scanDailyLimit(env);
  if (!env.DB) return { day, used: 0, budget, remaining: budget };
  const row = await env.DB.prepare('SELECT days FROM scan_budget WHERE day = ?')
    .bind(day)
    .first<{ days: number }>();
  const used = Number(row?.days ?? 0);
  return { day, used, budget, remaining: Math.max(0, budget - used) };
}

/** Reserves up to `requested` days from today's scan budget. Returns granted count. */
export async function consumeScanBudget(
  env: Env,
  requested: number,
  day = utcDay(),
): Promise<number> {
  if (!env.DB || requested <= 0) return 0;
  const status = await scanBudgetStatus(env, day);
  const granted = Math.min(requested, status.remaining);
  if (granted <= 0) return 0;
  await env.DB.prepare(
    `INSERT INTO scan_budget (day, days) VALUES (?, ?)
     ON CONFLICT(day) DO UPDATE SET days = days + excluded.days`,
  )
    .bind(day, granted)
    .run();
  return granted;
}

export function nextUtcMidnightMs(now = Date.now()): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 1, 0);
}
