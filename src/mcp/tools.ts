/**
 * MCP tool surface.
 *
 * Design constraints, from the project brief:
 * - Read-only by default. Write tools are registered only when the deployment
 *   sets WRITE_TOOLS_ENABLED=true, and even then require the write scope.
 * - Results are compact and stable; raw upstream payloads are never returned.
 * - "No training recorded" is a successful empty result, never an error.
 * - Failures are typed and carry a machine-readable code.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { metaFor, putCachedDay, subjectHash } from '../cache';
import { aggregateStats, movementHistory, normalizeTrain, summarizeDay } from '../domain/normalize';
import { addDays, todayInXunjiZone } from '../domain/date';
import { readRange, readDay, enumerateDates } from '../service/day-read';
import { readMovementCatalog, readPlan, readPlanList, upsertTrains } from '../upstream/client';
import type { AuthProps, Env, XunjiTrainResponse } from '../types';
import { SCOPES } from '../types';
import { failurePayload, jsonResult } from './result';
import { budgetedCachePut } from '../kv-budget';
import { registerQueryTools } from './query-tools';

export interface ToolContext {
  env: Env;
  props: AuthProps;
  signal?: AbortSignal;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 31;
const MAX_HISTORY_DAYS = 62;

const isoDate = z
  .string()
  .regex(DATE_PATTERN, 'Use YYYY-MM-DD')
  .describe("Calendar date in the user's Xunji timezone, e.g. 2026-11-18.");

function today(now = new Date()): string {
  return todayInXunjiZone(now);
}

function daysBetween(from: string, to: string): number {
  return enumerateDates(from, to).length;
}

export function readToolsEnabled(env: Env): boolean {
  return (env.WRITE_TOOLS_ENABLED ?? '').toLowerCase() === 'true';
}

export function domains(env: Env): string[] {
  return (env.ENABLED_DATA_DOMAINS ?? 'train')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function hasScope(props: AuthProps, scope: string): boolean {
  return Array.isArray(props.scope) && props.scope.includes(scope);
}

/** Builds a server with the tools this deployment and this token may use. */
export function buildServer(ctx: ToolContext): McpServer {
  const { env, props } = ctx;
  const server = new McpServer(
    { name: 'xunji-mcp', version: '0.2.0' },
    {
      instructions: [
        "Read-only access to the user's Xunji (训记) training records unless a write tool is explicitly present.",
        'Dates are the calendar days stored by Xunji; pass them as YYYY-MM-DD.',
        'An empty day or range means nothing was recorded, not that the request failed.',
        'Respect `meta.upstream.readRateLimitSeconds` and `retryAfterSeconds` before retrying a day.',
        'Never present these records as medical advice.',
      ].join(' '),
    },
  );

  const enabled = domains(env);
  const canRead = hasScope(props, SCOPES.read);

  registerQueryTools(server, ctx);

  /* ---------------------------------------------------------------- */
  /* Legacy per-day reads (kept for clients that connected before 0.2). */
  /* ---------------------------------------------------------------- */

  if (!enabled.includes('train') || !canRead) {
    return server;
  }

  /* ---------------------------------------------------------------- */
  /* One day, full fidelity.                                          */
  /* ---------------------------------------------------------------- */

  server.registerTool(
    'xunji_get_training_day',
    {
      title: 'Get one training day',
      description:
        'Returns every training session recorded on one calendar date: movements, sets, computed volume, duration and heart-rate summary. Use `detail: "full"` only when you need unchecked sets, RPE, notes or heart-rate buckets; full reads are rate limited at 30s per day. A date with no training returns an empty `trains` array, which is a successful result.',
      inputSchema: {
        date: isoDate,
        detail: z
          .enum(['summary', 'full'])
          .default('summary')
          .describe('summary omits unchecked sets, RPE, notes and heart-rate samples.'),
        includeNotes: z
          .boolean()
          .default(false)
          .describe('Include the session note text and parsed calorie/color fields.'),
        refresh: z
          .boolean()
          .default(false)
          .describe("Bypass this bridge's cache and re-read upstream."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ date, detail, includeNotes, refresh }) => {
      try {
        const full = detail === 'full';
        const result = await readDay(env, {
          subject: props.subject,
          datestr: date,
          full,
          fresh: refresh,
          signal: ctx.signal,
        });

        if (result.status === 'deferred') {
          return jsonResult(
            {
              date,
              status: 'deferred',
              reason: result.reason,
              retryAfterSeconds: result.retryAfterSeconds,
              hint: 'Call again after the retry window. Nothing is wrong with the date.',
              meta: metaFor({
                full,
                cached: false,
                retryAfterSeconds: result.retryAfterSeconds,
              }),
            },
            true,
          );
        }

        const response: XunjiTrainResponse = result.response;
        const trains = (response.trains ?? []).map((train) => {
          const normalized = normalizeTrain(train, { includeNotes });
          if (detail === 'summary') {
            return {
              ...normalized,
              movements: normalized.movements.map((movement) => ({
                ...movement,
                sets: movement.sets.filter((set) => set.done),
              })),
            };
          }
          return normalized;
        });

        return jsonResult({
          date,
          status: trains.length > 0 ? 'recorded' : 'no_training',
          trains,
          totals: {
            trainCount: trains.length,
            movementCount: trains.reduce((sum, t) => sum + t.movementCount, 0),
            completedSetCount: trains.reduce((sum, t) => sum + t.completedSetCount, 0),
            totalVolumeKg:
              Math.round(trains.reduce((sum, t) => sum + t.totalVolumeKg, 0) * 100) / 100,
            durationMinutes:
              Math.round(trains.reduce((sum, t) => sum + (t.durationMinutes ?? 0), 0) * 10) / 10,
          },
          meta: metaFor({
            full,
            cached: result.cached,
            cacheAgeSeconds: result.cacheAgeSeconds,
            limits: result.limits,
            upstreamTruncated: response.truncated === true,
          }),
        });
      } catch (error) {
        const failure = failurePayload(error);
        return jsonResult({ date, status: 'error', error: failure }, true);
      }
    },
  );

  /* ---------------------------------------------------------------- */
  /* Range overview.                                                  */
  /* ---------------------------------------------------------------- */

  server.registerTool(
    'xunji_list_training_days',
    {
      title: 'List training days in a range',
      description:
        'One row per calendar day in a range, with counts and volume but no set detail. Costs at most two uncached upstream reads per call; earlier days are served from cache. When a range is longer than the read budget, `pending` lists the dates not yet fetched — call again to continue, or narrow the range.',
      inputSchema: {
        from: isoDate,
        to: isoDate,
        refresh: z
          .boolean()
          .default(false)
          .describe('Re-read days from upstream instead of cache.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ from, to }) => {
      const span = daysBetween(from, to);
      if (span === 0) {
        return jsonResult(
          {
            status: 'error',
            error: { code: 'invalid_range', message: '`to` must be on or after `from`.' },
          },
          true,
        );
      }
      if (span > MAX_RANGE_DAYS) {
        return jsonResult(
          {
            status: 'error',
            error: {
              code: 'range_too_large',
              message: `This tool covers at most ${MAX_RANGE_DAYS} days per call (requested ${span}).`,
            },
          },
          true,
        );
      }

      try {
        const range = await readRange(env, {
          subject: props.subject,
          from,
          to,
          maxUpstreamReads: 2,
          signal: ctx.signal,
        });

        const days = range.days.map((day) => summarizeDay(day.datestr, day.response));
        return jsonResult({
          from,
          to,
          status: 'ok',
          days,
          daysRecorded: days.filter((day) => day.trainCount > 0).length,
          daysRequested: span,
          deferred: range.deferred,
          pending: range.pending,
          meta: metaFor({
            full: false,
            cached: range.upstreamReads === 0,
            limits: range.days.at(-1)?.limits,
          }),
        });
      } catch (error) {
        return jsonResult({ status: 'error', error: failurePayload(error) }, true);
      }
    },
  );

  /* ---------------------------------------------------------------- */
  /* Per-movement history.                                            */
  /* ---------------------------------------------------------------- */

  server.registerTool(
    'xunji_movement_history',
    {
      title: 'Movement history across days',
      description:
        'For named movements (exact Xunji Chinese names), returns one row per session occurrence in the range with completed sets, top weight, reps and volume. Use `xunji_search_movements` first when you are unsure of the canonical name. Range is capped at 62 days and two uncached upstream reads per call.',
      inputSchema: {
        movements: z
          .array(z.string().min(1))
          .min(1)
          .max(8)
          .describe('Exact movement names as stored by Xunji, e.g. ["杠铃卧推"].'),
        from: isoDate,
        to: isoDate,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ movements, from, to }) => {
      const span = daysBetween(from, to);
      if (span === 0 || span > MAX_HISTORY_DAYS) {
        return jsonResult(
          {
            status: 'error',
            error: {
              code: span === 0 ? 'invalid_range' : 'range_too_large',
              message: `Use a range of 1 to ${MAX_HISTORY_DAYS} days.`,
            },
          },
          true,
        );
      }

      try {
        const range = await readRange(env, {
          subject: props.subject,
          from,
          to,
          maxUpstreamReads: 2,
          signal: ctx.signal,
        });

        const trains = range.days.flatMap((day) => day.response.trains ?? []);
        const rows = movementHistory(trains, movements);

        return jsonResult({
          from,
          to,
          status: 'ok',
          movementsRequested: movements,
          rows,
          occurrences: rows.length,
          matchedMovements: [...new Set(rows.map((row) => row.movementName))],
          missingMovements: movements.filter(
            (name) => !rows.some((row) => row.movementName === name),
          ),
          deferred: range.deferred,
          pending: range.pending,
          meta: metaFor({ full: false, cached: range.upstreamReads === 0 }),
        });
      } catch (error) {
        return jsonResult({ status: 'error', error: failurePayload(error) }, true);
      }
    },
  );

  /* ---------------------------------------------------------------- */
  /* Aggregate stats.                                                 */
  /* ---------------------------------------------------------------- */

  server.registerTool(
    'xunji_training_stats',
    {
      title: 'Aggregate training statistics',
      description:
        'Aggregates a date range: sessions, movements, completed sets, total volume, total and average duration, weekday distribution, and the most-trained movements. Same 31-day cap and two-upstream-read budget as `xunji_list_training_days`.',
      inputSchema: {
        from: isoDate,
        to: isoDate,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ from, to }) => {
      const span = daysBetween(from, to);
      if (span === 0 || span > MAX_RANGE_DAYS) {
        return jsonResult(
          {
            status: 'error',
            error: {
              code: span === 0 ? 'invalid_range' : 'range_too_large',
              message: `Use a range of 1 to ${MAX_RANGE_DAYS} days.`,
            },
          },
          true,
        );
      }

      try {
        const range = await readRange(env, {
          subject: props.subject,
          from,
          to,
          maxUpstreamReads: 2,
          signal: ctx.signal,
        });

        const stats = aggregateStats(
          range.days.map((day) => ({ date: day.datestr, response: day.response })),
        );
        return jsonResult({
          status: 'ok',
          stats,
          deferred: range.deferred,
          pending: range.pending,
          meta: metaFor({ full: false, cached: range.upstreamReads === 0 }),
        });
      } catch (error) {
        return jsonResult({ status: 'error', error: failurePayload(error) }, true);
      }
    },
  );

  /* ---------------------------------------------------------------- */
  /* Movement catalog search — public, no key needed upstream.        */
  /* ---------------------------------------------------------------- */

  server.registerTool(
    'xunji_search_movements',
    {
      title: 'Search canonical movement names',
      description:
        'Searches the public Xunji movement catalog (about 1,200 names) by substring and returns canonical Chinese names plus category. Use this before `xunji_movement_history` or any write, so names match exactly. The catalog is public and cached by this bridge.',
      inputSchema: {
        query: z.string().min(1).max(40).describe('Substring to match, e.g. "卧推" or "squat".'),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ query, limit }) => {
      try {
        const cacheKey = 'movement_catalog:v1';
        let catalog = await env.CACHE_KV.get(cacheKey, 'json');
        const cached = catalog !== null;
        if (!catalog) {
          const { value } = await readMovementCatalog(env, ctx.signal);
          catalog = value;
          await budgetedCachePut(env, cacheKey, JSON.stringify(value), 7 * 24 * 60 * 60);
        }

        const entries =
          (catalog as { movements?: Array<{ name: string; type?: string; aliases?: string[] }> })
            .movements ?? [];
        const needle = query.trim().toLowerCase();
        const matches = entries
          .filter((entry) => {
            const name = entry.name.toLowerCase();
            if (name.includes(needle)) return true;
            return (entry.aliases ?? []).some((alias) => alias.toLowerCase().includes(needle));
          })
          .slice(0, limit)
          .map((entry) => {
            const row: { name: string; category?: string; aliases?: string[] } = {
              name: entry.name,
            };
            if (entry.type) row.category = entry.type;
            if (entry.aliases?.length) row.aliases = entry.aliases;
            return row;
          });

        return jsonResult({
          status: 'ok',
          query,
          matches,
          matchCount: matches.length,
          catalogSize: entries.length,
          meta: metaFor({ full: false, cached }),
        });
      } catch (error) {
        return jsonResult({ status: 'error', error: failurePayload(error) }, true);
      }
    },
  );

  /* ---------------------------------------------------------------- */
  /* Official plans — read-only, verified contract.                   */
  /* ---------------------------------------------------------------- */

  server.registerTool(
    'xunji_list_plans',
    {
      title: 'List official training plans',
      description:
        'Lists the official PlatformPlan and UniversalPlan schedules the user has in Xunji, with status and date span. Read-only.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const { value } = await readPlanList(env, ctx.signal);
        return jsonResult({
          status: 'ok',
          plans: value.plans ?? [],
          planCount: value.plans?.length ?? 0,
          meta: metaFor({ full: false, cached: false }),
        });
      } catch (error) {
        return jsonResult({ status: 'error', error: failurePayload(error) }, true);
      }
    },
  );

  server.registerTool(
    'xunji_get_plan',
    {
      title: 'Read one official plan',
      description:
        "Returns one official plan's schedule for a date window (default: 7 days back to 30 days forward, capped at 92 days). Pass `planRef` from `xunji_list_plans`. Read-only; never writes schedule changes.",
      inputSchema: {
        planRef: z
          .string()
          .min(1)
          .describe('Plan reference from xunji_list_plans, e.g. "universal:4".'),
        from: isoDate.optional(),
        to: isoDate.optional(),
        includeMovements: z.boolean().default(true),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ planRef, from, to, includeMovements }) => {
      const anchor = today();
      const start = from ?? addDays(anchor, -7);
      const end = to ?? addDays(anchor, 30);
      const span = daysBetween(start, end);
      if (span === 0 || span > 92) {
        return jsonResult(
          {
            status: 'error',
            error: {
              code: span === 0 ? 'invalid_range' : 'range_too_large',
              message: 'Official plan reads cover 1 to 92 days.',
            },
          },
          true,
        );
      }

      try {
        const { value } = await readPlan(env, planRef, start, end, includeMovements, ctx.signal);
        return jsonResult({
          status: 'ok',
          planRef,
          from: start,
          to: end,
          plan: value.plan ?? null,
          days: value.days ?? [],
          dateRange: value.date_range ?? null,
          meta: metaFor({ full: false, cached: false }),
        });
      } catch (error) {
        return jsonResult({ status: 'error', error: failurePayload(error) }, true);
      }
    },
  );

  /* ---------------------------------------------------------------- */
  /* Optional, opt-in write tool.                                      */
  /* ---------------------------------------------------------------- */

  if (readToolsEnabled(env) && hasScope(props, SCOPES.write)) {
    server.registerTool(
      'xunji_upsert_training_day',
      {
        title: 'Create or update a training session (write)',
        description:
          'Creates or updates ONE training session for one date. This is a real write: the upstream service ignores preview flags, so there is no dry run. Call only after the user has explicitly asked for this change and has confirmed the exact movements, sets, weights and reps. Existing sessions are updated only when you pass their `localid`; omitting `localid` creates a new session. This tool never deletes records.',
        inputSchema: {
          date: isoDate,
          confirmed: z
            .literal(true)
            .describe('Must be true, after the user explicitly confirmed this exact change.'),
          clientRequestId: z
            .string()
            .min(8)
            .max(128)
            .describe('Idempotency key chosen by you; reuse it when retrying the same change.'),
          localid: z
            .number()
            .int()
            .optional()
            .describe('Existing session id to update. Omit to create a new session.'),
          title: z.string().min(1).max(60).optional(),
          movements: z
            .array(
              z.object({
                name: z.string().min(1).max(40),
                restTime: z.number().int().min(0).max(86_400).optional(),
                warn_restTime: z.number().int().min(0).max(86_400).optional(),
                sets: z
                  .array(
                    z.object({
                      weight: z.string().max(12).optional(),
                      unit: z.string().max(8).optional(),
                      reps: z.string().max(8).optional(),
                      time: z.number().int().min(0).max(86_400).optional(),
                      selfWeight: z.boolean().optional(),
                      rpe: z.string().max(4).optional(),
                      setType: z.string().max(4).optional(),
                      done: z.boolean().default(true),
                    }),
                  )
                  .min(1)
                  .max(20),
              }),
            )
            .min(1)
            .max(15),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ date, confirmed, clientRequestId, localid, title, movements }) => {
        if (confirmed !== true) {
          return jsonResult(
            {
              status: 'error',
              error: {
                code: 'confirmation_required',
                message: 'Explicit user confirmation is required.',
              },
            },
            true,
          );
        }

        const today = new Date();
        const parsed = new Date(`${date}T00:00:00Z`);
        const sixMonths = 190 * 86_400_000;
        if (
          Number.isNaN(parsed.getTime()) ||
          Math.abs(parsed.getTime() - today.getTime()) > sixMonths
        ) {
          return jsonResult(
            {
              status: 'error',
              error: {
                code: 'date_out_of_range',
                message: 'Writes are accepted only within six months of today.',
              },
            },
            true,
          );
        }

        const session: Record<string, unknown> = { datestr: date, movements };
        if (localid !== undefined) session.localid = localid;
        if (title) session.title = title;

        try {
          const { value } = await upsertTrains(
            env,
            { client_request_id: clientRequestId, res: [session], include_full_data: false },
            ctx.signal,
          );
          const written = value.trains ?? [];
          if (written.length > 0) {
            const hash = await subjectHash(props.subject);
            await putCachedDay(env, hash, date, false, value);
          }
          return jsonResult({
            status: 'written',
            date,
            localids: written.map((train) => train.localid),
            sessions: written.map((train) => normalizeTrain(train)),
            meta: metaFor({ full: false, cached: false }),
          });
        } catch (error) {
          return jsonResult({ status: 'error', error: failurePayload(error) }, true);
        }
      },
    );
  }

  return server;
}
