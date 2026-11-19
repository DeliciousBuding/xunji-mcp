/**
 * Upstream client for the Xunji (训记) Open API.
 *
 * Only endpoints verified against the vendor's published Open API skill and
 * live read-only probing are implemented. Anything not verified is absent
 * rather than guessed.
 *
 * Verified contract notes:
 * - `POST /api_trains_for_llm_v2` on trains.xunjiapp.cn, JSON body
 *   `{ schema_version: "train_open_api_v2", datestr: "YYYY-MM-DD", include_full_data?: boolean }`.
 * - `POST /api_movement_catalog_for_llm_v2` takes `{}` and needs no key.
 * - `POST /open/plan/query_gzip` on api.xunjiapp.cn for official plans.
 * - Every reply is `{ res }`; `res` is a payload object or a failure string such
 *   as `"too frequent, retry after 30s"` / `"apikey invalid"`.
 * - HTTP status stays 200 for application errors, so status is not the signal.
 * - Bodies may be gzip-compressed at the transfer layer.
 */

import type { Env, XunjiEnvelope, XunjiLimits, XunjiTrainResponse } from '../types';

export const UPSTREAM = {
  trainsBase: 'https://trains.xunjiapp.cn',
  apiBase: 'https://api.xunjiapp.cn',
  trainsPath: '/api_trains_for_llm_v2',
  upsertPath: '/api_upsert_trains_for_llm_v2',
  catalogPath: '/api_movement_catalog_for_llm_v2',
  planPath: '/open/plan/query_gzip',
  schemaVersion: 'train_open_api_v2',
  planSchemaVersion: 'plan_open_api_v1',
} as const;

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export type UpstreamFailureCode =
  | 'rate_limited'
  | 'unauthorized'
  | 'vip_required'
  | 'invalid_request'
  | 'upstream_unavailable'
  | 'timeout'
  | 'bad_payload'
  | 'not_configured';

/** A structured upstream failure. Never contains the API key or raw payload. */
export class UpstreamError extends Error {
  constructor(
    readonly code: UpstreamFailureCode,
    message: string,
    readonly retryAfterSeconds?: number,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export interface ReadOptions {
  /** Bypass any client-side short cache. */
  fresh?: boolean;
  /** Vendor-specific full payload mode. Expensive; 30s spacing. */
  full?: boolean;
  signal?: AbortSignal;
}

export interface ReadResult<T> {
  data: T;
  limits?: XunjiLimits;
  /** True when the reply came from our cache. */
  cached: boolean;
  cacheAgeSeconds?: number;
}

export interface CachedRead<T> {
  at: number;
  data: T;
  limits?: XunjiLimits;
}

/** Extracts a `too frequent, retry after 30s` hint without exposing the rest. */
export function parseRetryAfterSeconds(text: string): number | undefined {
  const match = /retry after (\d+)\s*s/i.exec(text);
  if (!match) return undefined;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/** Maps an upstream `res` failure string to a typed error. */
export function classifyFailure(raw: string): UpstreamError {
  const text = raw.trim();
  const lower = text.toLowerCase();
  const retryAfter = parseRetryAfterSeconds(text);

  if (retryAfter !== undefined || lower.includes('too frequent')) {
    return new UpstreamError(
      'rate_limited',
      'Xunji is rate limiting this API key for the requested day.',
      retryAfter ?? 15,
    );
  }
  if (lower.includes('apikey missing') || lower.includes('apikey invalid')) {
    return new UpstreamError('unauthorized', 'The configured Xunji API key was rejected.');
  }
  if (text.includes('仅VIP可用')) {
    return new UpstreamError('vip_required', 'The Xunji account needs an active membership.');
  }
  if (lower.includes('datestr invalid') || lower.includes('schema_version')) {
    return new UpstreamError('invalid_request', 'Xunji rejected the request parameters.');
  }
  // Unknown vendor text is reported as a generic failure; the raw string can
  // contain user data, so it is not echoed into tool output.
  return new UpstreamError('upstream_unavailable', 'Xunji returned an unrecognized failure.');
}

function timeoutMs(env: Env): number {
  const parsed = Number(env.UPSTREAM_TIMEOUT_MS ?? '');
  return Number.isFinite(parsed) && parsed >= 1000 ? parsed : DEFAULT_TIMEOUT_MS;
}

/** Decompresses a gzip body if the runtime did not already do it. */
async function maybeDecompress(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  return new TextDecoder().decode(bytes);
}

function apiKey(env: Env): string {
  const key = env.XUNJI_API_KEY?.trim();
  if (!key) {
    throw new UpstreamError('not_configured', 'This deployment has no Xunji API key configured.');
  }
  return key;
}

/**
 * Sends one JSON POST to an upstream Xunji endpoint and unwraps `{ res }`.
 * Never logs the key or the body.
 */
export async function postJson<T>(
  env: Env,
  url: string,
  body: unknown,
  opts: { authRequired: boolean; signal?: AbortSignal; timeoutMs?: number } = { authRequired: true },
): Promise<{ value: T; limits?: XunjiLimits }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? timeoutMs(env));
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort);

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    'accept-encoding': 'gzip',
    'user-agent': 'xunji-mcp/0.1 (+https://github.com/)',
  };
  if (opts.authRequired) headers.authorization = `Bearer ${apiKey(env)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: 'follow',
      cf: { cacheTtl: 0 },
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new UpstreamError('timeout', 'Xunji did not answer in time.');
    }
    throw new UpstreamError('upstream_unavailable', 'Could not reach Xunji.');
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }

  if (response.status === 401 || response.status === 403) {
    throw new UpstreamError('unauthorized', 'Xunji rejected this deployment\'s credentials.', undefined, response.status);
  }
  if (!response.ok) {
    throw new UpstreamError(
      'upstream_unavailable',
      `Xunji answered HTTP ${response.status}.`,
      undefined,
      response.status,
    );
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_BODY_BYTES) {
    throw new UpstreamError('bad_payload', 'Xunji replied with an oversized body.');
  }

  let envelope: XunjiEnvelope<T>;
  try {
    const text = await maybeDecompress(buffer);
    envelope = JSON.parse(text) as XunjiEnvelope<T>;
  } catch {
    throw new UpstreamError('bad_payload', 'Xunji replied with a body that is not JSON.');
  }

  if (typeof envelope === 'string') {
    throw classifyFailure(envelope);
  }
  if (envelope.error && typeof envelope.error !== 'string' && envelope.error.message) {
    throw new UpstreamError('invalid_request', `Xunji rejected the request: ${envelope.error.code ?? 'invalid'}.`);
  }
  const res = envelope.res;
  if (typeof res === 'string') {
    throw classifyFailure(res);
  }
  if (res === null || typeof res !== 'object') {
    throw new UpstreamError('bad_payload', 'Xunji replied without a usable payload.');
  }

  const limits = (res as { limits?: XunjiLimits }).limits;
  return { value: res as T, limits };
}

/** Reads one training day. */
export async function readTrainDay(
  env: Env,
  datestr: string,
  full: boolean,
  signal?: AbortSignal,
): Promise<{ value: XunjiTrainResponse; limits?: XunjiLimits }> {
  return postJson<XunjiTrainResponse>(
    env,
    `${UPSTREAM.trainsBase}${UPSTREAM.trainsPath}`,
    {
      schema_version: UPSTREAM.schemaVersion,
      datestr,
      include_full_data: full,
    },
    { authRequired: true, signal },
  );
}

/**
 * Writes training records.
 *
 * WARNING: the vendor's training upsert endpoint ignores `dry_run`. A request
 * carrying `dry_run: true` was observed to create the record anyway, so this
 * bridge NEVER sends that flag and never treats it as a preview. Any call to
 * this function is a real write and must be reached only from a tool that the
 * deployment enabled explicitly and the user confirmed.
 */
export async function upsertTrains(
  env: Env,
  payload: {
    client_request_id: string;
    res: Array<Record<string, unknown>>;
    include_full_data?: boolean;
  },
  signal?: AbortSignal,
): Promise<{ value: XunjiTrainResponse; limits?: XunjiLimits }> {
  return postJson<XunjiTrainResponse>(
    env,
    `${UPSTREAM.trainsBase}${UPSTREAM.upsertPath}`,
    {
      schema_version: UPSTREAM.schemaVersion,
      client_request_id: payload.client_request_id,
      res: payload.res,
      ...(payload.include_full_data ? { include_full_data: true } : {}),
    },
    { authRequired: true, signal },
  );
}

export interface MovementCatalogEntry {
  name: string;
  type?: string;
  exetype?: string;
  aliases?: string[];
}

/** Reads the public movement-name catalog. Unauthenticated upstream. */
export async function readMovementCatalog(
  env: Env,
  signal?: AbortSignal,
): Promise<{ value: { schema?: string; version?: number; movements: MovementCatalogEntry[] }; limits?: XunjiLimits }> {
  return postJson(
    env,
    `${UPSTREAM.trainsBase}${UPSTREAM.catalogPath}`,
    {},
    { authRequired: false, signal },
  );
}

export interface PlanSummary {
  plan_ref: string;
  plan_type?: string;
  plan_id?: string;
  title?: string;
  description?: string;
  status?: string;
  start_date?: string;
  end_date?: string;
  day_count?: number;
  training_day_count?: number;
  next_scheduled_training_date?: string;
}

/** Lists the operator's official plans. */
export async function readPlanList(
  env: Env,
  signal?: AbortSignal,
): Promise<{ value: { plans?: PlanSummary[] }; limits?: XunjiLimits }> {
  return postJson(
    env,
    `${UPSTREAM.apiBase}${UPSTREAM.planPath}`,
    { schema_version: UPSTREAM.planSchemaVersion, action: 'list' },
    { authRequired: true, signal },
  );
}

/** Reads one official plan over a bounded date range. */
export async function readPlan(
  env: Env,
  planRef: string,
  startDate: string,
  endDate: string,
  includeMovements: boolean,
  signal?: AbortSignal,
): Promise<{ value: Record<string, unknown>; limits?: XunjiLimits }> {
  return postJson<Record<string, unknown>>(
    env,
    `${UPSTREAM.apiBase}${UPSTREAM.planPath}`,
    {
      schema_version: UPSTREAM.planSchemaVersion,
      action: 'get',
      plan_ref: planRef,
      start_date: startDate,
      end_date: endDate,
      include_movements: includeMovements,
    },
    { authRequired: true, signal },
  );
}