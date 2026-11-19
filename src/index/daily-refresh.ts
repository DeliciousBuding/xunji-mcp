/**
 * Daily incremental refresh.
 *
 * A backfill covers history once; this keeps the tail current. It enqueues only
 * the gap between the latest terminal scan and yesterday, so a paused scanner or
 * a long outage resumes without re-reading covered days. Today is excluded
 * because the source day may still be in progress; tomorrow's run picks it up.
 */

import { addDays, todayInXunjiZone } from '../domain/date';
import type { Env } from '../types';
import { enqueueRefresh, getMeta, latestCoveredDate } from './store';

export interface DailyGap {
  from: string;
  to: string;
  enqueued: number;
}

export async function enqueueDailyGap(
  env: Env,
  today = todayInXunjiZone(),
): Promise<DailyGap | null> {
  if (!env.DB) return null;
  const historyStart =
    (await getMeta<string>(env, 'history_start')) ?? env.HISTORY_START_DATE ?? null;
  if (!historyStart) return null;

  const latest = await latestCoveredDate(env);
  const from = latest ? addDays(latest, 1) : historyStart;
  const to = addDays(today, -1);
  if (from > to) return null;

  return { from, to, enqueued: await enqueueRefresh(env, from, to) };
}
