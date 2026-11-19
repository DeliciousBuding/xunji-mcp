/**
 * Background history scanner.
 *
 * Xunji has no bulk/range endpoint, so covering years of history means one
 * upstream call per calendar day. A Worker request cannot hold that open, and a
 * client should not loop hundreds of times. This Durable Object owns an alarm
 * loop instead: it drains a persisted queue in D1, respects the per-day gate,
 * retries with backoff, and survives restarts.
 */

import { DurableObject } from 'cloudflare:workers';

import { readDay } from '../service/day-read';
import type { Env } from '../types';
import {
  consumeScanBudget,
  dueScanDates,
  getMeta,
  isScanPaused,
  markScanResult,
  nextUtcMidnightMs,
  replaceDay,
  scanBudgetStatus,
} from './store';

const SCAN_STATE_KEY = 'scan';
const BATCH_SIZE = 9;
const CONCURRENCY = 3;
const TIME_BUDGET_MS = 20_000;

interface ScanState {
  subject: string;
  fresh: boolean;
  startedAt: number;
  processed: number;
}

export class ScanCoordinator extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  /** RPC: begin or resume a backfill. Dates are already enqueued by the caller. */
  async start(subject: string, fresh: boolean): Promise<void> {
    const state: ScanState = {
      subject,
      fresh,
      startedAt: Date.now(),
      processed: 0,
    };
    await this.ctx.storage.put(SCAN_STATE_KEY, state);
    await this.ctx.storage.setAlarm(Date.now() + 50);
  }

  /** RPC: resume an existing queue without changing its start time. */
  async resume(): Promise<void> {
    const state = await this.ctx.storage.get<ScanState>(SCAN_STATE_KEY);
    if (!state) return;
    await this.ctx.storage.setAlarm(Date.now() + 50);
  }

  /** RPC: pause. The queue stays in D1 and can be resumed later. */
  async pause(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
  }

  override async alarm(): Promise<void> {
    const state = await this.ctx.storage.get<ScanState>(SCAN_STATE_KEY);
    if (!state) return;
    if (await isScanPaused(this.env)) return;

    const budget = await scanBudgetStatus(this.env);
    if (budget.remaining <= 0) {
      await this.ctx.storage.setAlarm(nextUtcMidnightMs());
      return;
    }

    const deadline = Date.now() + TIME_BUDGET_MS;
    const batchLimit = Math.min(BATCH_SIZE, budget.remaining);
    let processed = 0;

    while (processed < batchLimit && Date.now() < deadline) {
      const dates = await dueScanDates(this.env, Math.min(CONCURRENCY, batchLimit - processed));
      if (dates.length === 0) break;

      await Promise.all(
        dates.map(async (date) => {
          try {
            const result = await readDay(this.env, {
              subject: state.subject,
              datestr: date,
              fresh: state.fresh,
              maxWaitMs: 8_000,
              // Backfill persists to D1 only. Writing KV here would burn the
              // account-wide free quota for entries the read path never uses.
              useCache: false,
              persistCache: false,
            });
            if (result.status === 'data') {
              await replaceDay(this.env, date, result.response);
            } else {
              await markScanResult(this.env, date, {
                status: 'pending',
                retryAfterMs: result.retryAfterSeconds * 1000,
                error: `vendor ${result.reason}`,
              });
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : 'unknown error';
            await markScanResult(this.env, date, {
              status: 'error',
              retryAfterMs: 60_000,
              error: message,
            });
          }
        }),
      );
      processed += dates.length;
    }

    state.processed += processed;
    await this.ctx.storage.put(SCAN_STATE_KEY, state);
    if (processed > 0) await consumeScanBudget(this.env, processed);

    const after = await scanBudgetStatus(this.env);
    const remaining = await remainingDue(this.env);
    if (after.remaining <= 0 && (remaining.pending > 0 || remaining.error > 0)) {
      await this.ctx.storage.setAlarm(nextUtcMidnightMs());
    } else if (remaining.dueNow > 0) {
      await this.ctx.storage.setAlarm(Date.now() + 250);
    } else if (remaining.pending > 0 || remaining.error > 0) {
      const next = await nextAttemptAt(this.env);
      await this.ctx.storage.setAlarm(Math.max(Date.now() + 1_000, next ?? Date.now() + 60_000));
    }
  }
}

async function remainingDue(env: Env): Promise<{ dueNow: number; pending: number; error: number }> {
  if (!env.DB) return { dueNow: 0, pending: 0, error: 0 };
  const row = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status IN ('pending','error') AND (next_attempt_at IS NULL OR next_attempt_at <= ?) THEN 1 ELSE 0 END) AS due_now,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error
     FROM scan_day`,
  )
    .bind(Date.now())
    .first<Record<string, number>>();
  return {
    dueNow: Number(row?.due_now ?? 0),
    pending: Number(row?.pending ?? 0),
    error: Number(row?.error ?? 0),
  };
}

async function nextAttemptAt(env: Env): Promise<number | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare(
    `SELECT MIN(next_attempt_at) AS next FROM scan_day
     WHERE status IN ('pending','error') AND next_attempt_at IS NOT NULL`,
  ).first<{ next: number | null }>();
  return row?.next ?? null;
}

/** RPC helper for tools that want to read the durable scan state. */
export async function scanStartedAt(env: Env): Promise<number | null> {
  return getMeta<number>(env, 'scan_started_at');
}
