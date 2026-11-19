/**
 * Identity-scoped cache for upstream reads.
 *
 * Cached entries are keyed by a per-user hash so two allowlisted operators
 * (or a future multi-user deployment) can never read each other's days.
 * The cache stores already-normalized payloads, never raw upstream bodies.
 */

import { todayInXunjiZone } from './domain/date';
import { budgetedCachePut } from './kv-budget';
import type { Env, ToolResultMeta, XunjiLimits, XunjiTrainResponse } from './types';

const CACHE_VERSION = 'v1';

/**
 * Freshness policy, deliberately small.
 *
 * Cloudflare's free KV allowance is shared by every namespace on the account
 * and is write-bound (1,000/day). Historical training days are served from D1,
 * so they are never cached in KV; only today/yesterday get a short hot-key
 * cache. A zero means "do not write this to KV".
 */
export function cacheTtlSeconds(datestr: string, now = new Date()): number {
  const today = todayInXunjiZone(now);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
  if (datestr === today) return 5 * 60;
  if (datestr === yesterday) return 2 * 60;
  return 0;
}

export function isCacheEligible(datestr: string, now = new Date()): boolean {
  return cacheTtlSeconds(datestr, now) > 0;
}

/** Stable, non-reversible cache identity for a subject. */
export async function subjectHash(subject: string): Promise<string> {
  const data = new TextEncoder().encode(subject);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface CachedDay {
  at: number;
  datestr: string;
  response: XunjiTrainResponse;
  limits?: XunjiLimits;
}

function dayKey(hash: string, datestr: string, full: boolean): string {
  return `${CACHE_VERSION}:day:${hash}:${datestr}:${full ? 'full' : 'light'}`;
}

export async function getCachedDay(
  env: Env,
  hash: string,
  datestr: string,
  full: boolean,
): Promise<CachedDay | null> {
  const raw = await env.CACHE_KV.get(dayKey(hash, datestr, full), 'json');
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as CachedDay;
  if (entry.datestr !== datestr || typeof entry.at !== 'number') return null;
  const ageSeconds = (Date.now() - entry.at) / 1000;
  if (ageSeconds > cacheTtlSeconds(datestr)) return null;
  return entry;
}

export async function putCachedDay(
  env: Env,
  hash: string,
  datestr: string,
  full: boolean,
  response: XunjiTrainResponse,
  limits?: XunjiLimits,
): Promise<{ stored: boolean; degraded: boolean }> {
  const ttl = cacheTtlSeconds(datestr);
  if (ttl <= 0) return { stored: false, degraded: false };
  const entry: CachedDay = { at: Date.now(), datestr, response, limits };
  return budgetedCachePut(env, dayKey(hash, datestr, full), JSON.stringify(entry), ttl);
}

/** Builds the meta block every read tool returns. */
export function metaFor(options: {
  full: boolean;
  cached: boolean;
  cacheAgeSeconds?: number;
  limits?: XunjiLimits;
  retryAfterSeconds?: number;
  upstreamTruncated?: boolean;
  budgetDegraded?: boolean;
}): ToolResultMeta {
  const meta: ToolResultMeta = {
    upstream: {
      readRateLimitSeconds: options.full ? 30 : 15,
      cached: options.cached,
    },
  };
  if (options.cacheAgeSeconds !== undefined)
    meta.upstream.cacheAgeSeconds = options.cacheAgeSeconds;
  if (options.limits) meta.limits = options.limits;
  if (options.retryAfterSeconds !== undefined)
    meta.upstream.retryAfterSeconds = options.retryAfterSeconds;
  if (options.upstreamTruncated) meta.upstream.upstreamTruncated = true;
  if (options.budgetDegraded) meta.upstream.budgetDegraded = true;
  return meta;
}
