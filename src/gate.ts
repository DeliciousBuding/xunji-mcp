/**
 * Per-key upstream gate.
 *
 * Xunji enforces a per-day read interval (15s light / 30s full) and answers
 * HTTP 200 with `too frequent, retry after Ns` instead of 429. This Durable
 * Object keeps the reservation arithmetic in one place so concurrent callers do
 * not each burn a vendor quota slot and then fail visibly.
 *
 * It stores timestamps only — never payloads, never the API key.
 */

import { DurableObject } from 'cloudflare:workers';

import type { Env } from './types';

const STORAGE_PREFIX = 'gate:';

export interface GateState {
  /** Epoch ms of the last granted reservation. */
  lastAt: number;
  /** Epoch ms until which the vendor told us to stay away. */
  cooldownUntil: number;
}

export type Reservation =
  | { status: 'ready'; waitedMs: number }
  | { status: 'wait'; waitMs: number }
  | { status: 'cooldown'; retryAfterSeconds: number };

export class UpstreamGate extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/status')) {
      const state = await this.keyState(url.searchParams.get('key') ?? 'default');
      return Response.json(state);
    }
    if (url.pathname.endsWith('/cooldown')) {
      const retryAfter = Number(url.searchParams.get('retry_after') ?? '15');
      await this.setCooldown(url.searchParams.get('key') ?? 'default', retryAfter);
      return new Response(null, { status: 204 });
    }
    return new Response('not found', { status: 404 });
  }

  private async keyState(key: string): Promise<GateState> {
    return (
      (await this.ctx.storage.get<GateState>(STORAGE_PREFIX + key)) ?? {
        lastAt: 0,
        cooldownUntil: 0,
      }
    );
  }

  /**
   * Reserves one upstream slot for `key`. Returns immediately with either a
   * granted reservation or how long to wait first.
   */
  async reserve(key: string, minIntervalSeconds: number): Promise<Reservation> {
    const state = await this.keyState(key);
    const now = Date.now();

    if (state.cooldownUntil > now) {
      return { status: 'cooldown', retryAfterSeconds: Math.ceil((state.cooldownUntil - now) / 1000) };
    }

    const earliest = state.lastAt + Math.max(0, minIntervalSeconds) * 1000;
    if (earliest > now) {
      return { status: 'wait', waitMs: earliest - now };
    }

    await this.ctx.storage.put(STORAGE_PREFIX + key, {
      lastAt: now,
      cooldownUntil: state.cooldownUntil,
    } satisfies GateState);
    return { status: 'ready', waitedMs: 0 };
  }

  /** Records a vendor rate-limit reply so the next caller gets a precise hint. */
  async setCooldown(key: string, retryAfterSeconds: number): Promise<void> {
    const state = await this.keyState(key);
    await this.ctx.storage.put(STORAGE_PREFIX + key, {
      lastAt: state.lastAt,
      cooldownUntil: Date.now() + Math.max(1, retryAfterSeconds) * 1000,
    } satisfies GateState);
  }

  async clearCooldown(key: string): Promise<void> {
    const state = await this.keyState(key);
    await this.ctx.storage.put(STORAGE_PREFIX + key, { lastAt: state.lastAt, cooldownUntil: 0 });
  }
}