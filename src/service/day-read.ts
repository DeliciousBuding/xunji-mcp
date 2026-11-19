/**
 * Single-day read coordinator: cache, vendor pacing, normalization.
 *
 * All tools read days through here so caching and rate limiting behave
 * identically no matter which tool triggered the read.
 *
 * Xunji paces reads per (key, day): 15s for the light payload, 30s for
 * `include_full_data`. A range of N days therefore costs real wall-clock time,
 * so this module returns a "deferred" result instead of blocking indefinitely.
 */

import { getCachedDay, putCachedDay, subjectHash } from '../cache';
import { readTrainDay, UpstreamError } from '../upstream/client';
import type { Env, XunjiLimits, XunjiTrainResponse } from '../types';

export interface DayReadOptions {
  subject: string;
  datestr: string;
  full?: boolean;
  /** Skip the cache and read upstream again. */
  fresh?: boolean;
  /** How long this caller is willing to wait for the vendor pace. */
  maxWaitMs?: number;
  signal?: AbortSignal;
}

export type DayData = {
  status: 'data';
  datestr: string;
  response: XunjiTrainResponse;
  limits?: XunjiLimits;
  cached: boolean;
  cacheAgeSeconds?: number;
};

export type DayDeferred = {
  status: 'deferred';
  datestr: string;
  retryAfterSeconds: number;
  reason: 'vendor_cooldown' | 'vendor_pacing';
};

export type DayReadResult = DayData | DayDeferred;

const DEFAULT_MAX_WAIT_MS = 20_000;

export function gateKey(hash: string, datestr: string, full: boolean): string {
  return `${hash}:${datestr}:${full ? 'full' : 'light'}`;
}

function toDeferred(datestr: string, retryAfterSeconds: number, reason: DayDeferred['reason']): DayDeferred {
  return { status: 'deferred', datestr, retryAfterSeconds, reason };
}

export async function readCachedDay(
  env: Env,
  subject: string,
  datestr: string,
  full: boolean,
): Promise<DayData | null> {
  const hash = await subjectHash(subject);
  const cached = await getCachedDay(env, hash, datestr, full);
  if (!cached) return null;
  return {
    status: 'data',
    datestr,
    response: cached.response,
    limits: cached.limits,
    cached: true,
    cacheAgeSeconds: Math.round((Date.now() - cached.at) / 1000),
  };
}

export async function readDay(env: Env, options: DayReadOptions): Promise<DayReadResult> {
  const full = options.full === true;

  if (!options.fresh) {
    const cached = await readCachedDay(env, options.subject, options.datestr, full);
    if (cached) return cached;
  }

  const hash = await subjectHash(options.subject);
  const minIntervalSeconds = full ? 30 : 15;
  const key = gateKey(hash, options.datestr, full);
  const stub = env.UPSTREAM_GATE.get(env.UPSTREAM_GATE.idFromName(key));
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;

  const reserved = await stub.reserve(key, minIntervalSeconds);
  if (reserved.status === 'cooldown') {
    return toDeferred(options.datestr, reserved.retryAfterSeconds, 'vendor_cooldown');
  }
  if (reserved.status === 'wait') {
    if (reserved.waitMs > maxWaitMs) {
      return toDeferred(options.datestr, Math.ceil(reserved.waitMs / 1000), 'vendor_pacing');
    }
    await new Promise((resolve) => setTimeout(resolve, reserved.waitMs));
    const retry = await stub.reserve(key, minIntervalSeconds);
    if (retry.status === 'cooldown') {
      return toDeferred(options.datestr, retry.retryAfterSeconds, 'vendor_cooldown');
    }
    if (retry.status === 'wait') {
      return toDeferred(options.datestr, Math.ceil(retry.waitMs / 1000), 'vendor_pacing');
    }
  }

  try {
    const { value, limits } = await readTrainDay(env, options.datestr, full, options.signal);
    await putCachedDay(env, hash, options.datestr, full, value, limits);
    return { status: 'data', datestr: options.datestr, response: value, limits, cached: false };
  } catch (error) {
    if (error instanceof UpstreamError && error.code === 'rate_limited') {
      const retryAfter = error.retryAfterSeconds ?? minIntervalSeconds;
      await stub.setCooldown(key, retryAfter);
      return toDeferred(options.datestr, retryAfter, 'vendor_cooldown');
    }
    throw error;
  }
}

export interface RangeReadResult {
  days: DayData[];
  /** Dates the vendor pace made us skip on this call. */
  deferred: Array<{ date: string; retryAfterSeconds: number; reason: DayDeferred['reason'] }>;
  /** Dates not attempted because the upstream read budget ran out and no cache existed. */
  pending: string[];
  /** Uncached upstream reads performed. */
  upstreamReads: number;
}

export interface RangeOptions {
  subject: string;
  from: string;
  to: string;
  full?: boolean;
  /** Maximum number of *uncached* upstream reads this call may perform. */
  maxUpstreamReads?: number;
  signal?: AbortSignal;
}

export async function readRange(env: Env, options: RangeOptions): Promise<RangeReadResult> {
  const dates = enumerateDates(options.from, options.to);
  const full = options.full === true;
  const budget = Math.max(0, options.maxUpstreamReads ?? 2);
  const days: DayData[] = [];
  const deferred: RangeReadResult['deferred'] = [];
  let pending: string[] = [];
  let upstreamReads = 0;

  for (let i = 0; i < dates.length; i += 1) {
    const date = dates[i]!;
    if (options.signal?.aborted) {
      pending = dates.slice(i);
      break;
    }

    if (upstreamReads >= budget) {
      // Budget spent: only cache hits are allowed from here on.
      const cached = await readCachedDay(env, options.subject, date, full);
      if (cached) {
        days.push(cached);
        continue;
      }
      pending = dates.slice(i);
      break;
    }

    // Allow a modest wait for the vendor pace so adjacent cached days do not
    // each cost a full interval, but never long enough to look like a hang.
    const remaining = budget - upstreamReads;
    const result = await readDay(env, {
      subject: options.subject,
      datestr: date,
      full,
      maxWaitMs: remaining > 1 ? 16_000 : 8_000,
      signal: options.signal,
    });

    if (result.status === 'data') {
      days.push(result);
      if (!result.cached) upstreamReads += 1;
      continue;
    }
    deferred.push({
      date: result.datestr,
      retryAfterSeconds: result.retryAfterSeconds,
      reason: result.reason,
    });
  }

  return { days, deferred, pending, upstreamReads };
}

export function enumerateDates(from: string, to: string): string[] {
  const dates: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return dates;
  for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += 86_400_000) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return dates;
}