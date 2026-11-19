/**
 * KV write budget.
 *
 * The account's free KV allowance is shared across every Worker and is
 * write-bound. The derived index is in D1, so KV is only a small hot-key cache;
 * every write goes through this counter and fails closed (skip the write) when
 * the daily budget is exhausted.
 */

import type { Env } from './types';

export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function kvWriteBudget(env: Env): number {
  const parsed = Number(env.KV_WRITE_DAILY_BUDGET ?? '300');
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 300;
}

export interface BudgetPutResult {
  stored: boolean;
  /** True when the write was skipped because the budget or D1 was unavailable. */
  degraded: boolean;
}

export async function budgetedCachePut(
  env: Env,
  key: string,
  value: string,
  ttlSeconds: number,
): Promise<BudgetPutResult> {
  if (ttlSeconds <= 0) return { stored: false, degraded: false };
  if (!env.DB) return { stored: false, degraded: true };

  const day = utcDay();
  const budget = kvWriteBudget(env);
  try {
    const row = await env.DB.prepare(
      `INSERT INTO kv_budget (day, writes) VALUES (?, 1)
       ON CONFLICT(day) DO UPDATE SET writes = writes + 1
       RETURNING writes`,
    )
      .bind(day)
      .first<{ writes: number }>();
    if (Number(row?.writes ?? budget + 1) > budget) return { stored: false, degraded: true };
  } catch {
    return { stored: false, degraded: true };
  }

  try {
    await env.CACHE_KV.put(key, value, { expirationTtl: Math.max(60, ttlSeconds) });
    return { stored: true, degraded: false };
  } catch {
    return { stored: false, degraded: true };
  }
}

export async function kvWritesToday(env: Env): Promise<{ used: number; budget: number }> {
  const budget = kvWriteBudget(env);
  if (!env.DB) return { used: 0, budget };
  const row = await env.DB.prepare('SELECT writes FROM kv_budget WHERE day = ?')
    .bind(utcDay())
    .first<{ writes: number }>();
  return { used: Number(row?.writes ?? 0), budget };
}
