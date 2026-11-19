/**
 * Agent-native query surface.
 *
 * Instead of one tool per REST endpoint, these tools answer analysis tasks:
 * overview, grouped metrics, movement progress, and index coverage. The model
 * asks a question; SQLite does the arithmetic; only compact columns return.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { capabilityMatrix } from '../capabilities';
import { addDays, todayInXunjiZone } from '../domain/date';
import { METRIC_KEYS, type MetricKey } from '../domain/metrics';
import {
  movementProgress,
  queryTraining,
  trainingOverview,
  type GroupBy,
  type OrderBy,
  type RangePreset,
} from '../index/query';
import {
  contiguousVerifiedFrom,
  enqueueRange,
  enqueueRefresh,
  getCoverage,
  getMeta,
  scanBudgetStatus,
  isScanPaused,
  scanStatusCounts,
  setHistoryStart,
  setMeta,
  setScanPaused,
} from '../index/store';
import { kvWritesToday } from '../kv-budget';
import { BODY_TYPES, readBody, readFoodRecords, searchFoods } from '../upstream/domains';
import type { AuthProps, Env } from '../types';
import { SCOPES } from '../types';
import { compactResult, failurePayload, jsonResult } from './result';

export interface QueryToolContext {
  env: Env;
  props: AuthProps;
  signal?: AbortSignal;
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .describe('Calendar date in the Xunji timezone.');

const rangeSchema = z
  .object({
    preset: z
      .enum(['all_time', 'last_7d', 'last_30d', 'last_90d', 'last_365d', 'ytd'])
      .optional()
      .describe('Ignored when from/to are supplied.'),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .optional();

const metricsSchema = z
  .array(z.enum(METRIC_KEYS as [MetricKey, ...MetricKey[]]))
  .max(9)
  .optional();

function rangeInput(range: z.infer<typeof rangeSchema>): {
  from?: string;
  to?: string;
  preset?: RangePreset;
} {
  if (!range) return {};
  return {
    ...(range.from ? { from: range.from } : {}),
    ...(range.to ? { to: range.to } : {}),
    ...(range.preset ? { preset: range.preset } : {}),
  };
}

function coverageLine(coverage: {
  days: number;
  scannedDays: number;
  pendingDays: number;
  errorDays: number;
}): string {
  const pct = coverage.days > 0 ? Math.round((coverage.scannedDays / coverage.days) * 100) : 0;
  const gaps = coverage.pendingDays + coverage.errorDays;
  return `coverage ${pct}% (${coverage.scannedDays}/${coverage.days} days${gaps ? `, ${gaps} pending` : ''})`;
}

export function registerQueryTools(server: McpServer, ctx: QueryToolContext): void {
  const { env, props } = ctx;
  const canRead = Array.isArray(props.scope) && props.scope.includes(SCOPES.read);
  if (!canRead) return;

  const trainEnabled = (env.ENABLED_DATA_DOMAINS ?? 'train')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .includes('train');
  const hasIndex = Boolean(env.DB) && trainEnabled;
  const hasScanner = Boolean(env.DB && env.SCAN_COORDINATOR) && trainEnabled;

  /* ---------------------------------------------------------------- */
  /* Capability matrix                                                */
  /* ---------------------------------------------------------------- */

  server.registerTool(
    'xunji_capabilities',
    {
      title: 'Describe this Xunji bridge',
      description:
        'Returns the implemented endpoint coverage matrix: domain, endpoint, tool, scope, whether the deployment is configured for it, and whether it has been verified live. Also reports index coverage. Call this before assuming a domain exists.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const matrix = capabilityMatrix(env);
      const counts = hasIndex ? await scanStatusCounts(env) : null;
      const historyStart =
        (await getMeta<string>(env, 'history_start')) ?? env.HISTORY_START_DATE ?? null;
      const payload = {
        server: 'xunji-mcp',
        version: '0.2.0',
        scopes: props.scope,
        writeToolsEnabled:
          (env.WRITE_TOOLS_ENABLED ?? '').toLowerCase() === 'true' &&
          props.scope.includes(SCOPES.write),
        domains: matrix,
        index: hasIndex
          ? {
              available: true,
              historyStart,
              scannedDays: (counts?.complete ?? 0) + (counts?.empty ?? 0),
              pendingDays: counts?.pending ?? 0,
              errorDays: counts?.error ?? 0,
              scanBudget: await scanBudgetStatus(env),
              kv: await kvWritesToday(env),
            }
          : {
              available: false,
              note: 'Enable D1 and run xunji_history to unlock all-history queries.',
            },
        limits: {
          readRateLimitSeconds: 15,
          readRateLimitFullSeconds: 30,
          maxQuerySpanDays: 7320,
          maxRowsPerQuery: 400,
          maxSetRows: 400,
        },
      };
      return compactResult(
        payload,
        `xunji-mcp 0.2.0: ${matrix.filter((row) => row.status === 'ready').length} ready capabilities, ${matrix.filter((row) => row.status === 'unconfigured').length} unconfigured, ${matrix.filter((row) => row.status === 'not_implemented').length} not implemented.`,
      );
    },
  );

  /* ---------------------------------------------------------------- */
  /* Composable training query                                        */
  /* ---------------------------------------------------------------- */

  if (hasIndex) {
    server.registerTool(
      'xunji_query_training',
      {
        title: 'Query training history',
        description:
          'One declarative query over the indexed training history. Choose a range, optional movement or muscle filters, a grouping dimension, and the metrics you need. Aggregation runs server-side and returns compact columns, not per-set payloads. Use groupBy "movement" with topK for ranked lists; use includeSets only for a bounded drill-down. Coverage is reported separately: a partial index never means an empty period.',
        inputSchema: {
          range: rangeSchema,
          movements: z
            .array(z.string().min(1))
            .max(20)
            .optional()
            .describe('Exact Xunji movement names.'),
          muscleGroups: z
            .array(z.string().min(1))
            .max(8)
            .optional()
            .describe('Vendor `type` values, e.g. 胸/背/腿.'),
          groupBy: z
            .enum(['total', 'day', 'week', 'month', 'year', 'movement', 'muscle_group'])
            .default('month'),
          fields: metricsSchema,
          includeWarmups: z.boolean().default(false),
          includeToday: z.boolean().default(false),
          topK: z.number().int().min(1).max(50).optional(),
          orderBy: z.enum(['volume_kg', 'sets', 'reps', 'est_1rm_kg', 'sessions']).optional(),
          limit: z.number().int().min(1).max(400).optional(),
          includeSets: z.boolean().default(false),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (input) => {
        try {
          const result = await queryTraining(env, {
            ...rangeInput(input.range),
            movements: input.movements,
            muscleGroups: input.muscleGroups,
            groupBy: input.groupBy as GroupBy,
            fields: input.fields as MetricKey[] | undefined,
            includeWarmups: input.includeWarmups,
            includeToday: input.includeToday,
            topK: input.topK,
            orderBy: input.orderBy as OrderBy | undefined,
            limit: input.limit,
            includeSets: input.includeSets,
          });
          const summary = `Training query: ${result.rowCount} rows; ${result.totals.sessions ?? 0} sessions; ${result.totals.sets ?? 0} sets; ${result.totals.volume_kg ?? 0} kg; ${coverageLine(result.coverage)}${result.unmatchedMovements.length ? `; unmatched: ${result.unmatchedMovements.join(', ')}` : ''}.`;
          return compactResult(result as unknown as Record<string, unknown>, summary);
        } catch (error) {
          return jsonResult({ status: 'error', error: failurePayload(error) }, true);
        }
      },
    );

    server.registerTool(
      'xunji_training_overview',
      {
        title: 'All-history training overview',
        description:
          'High-level KPIs for a range (default all indexed history): sessions, training days, sets, volume, duration, recent 4-week trend, top movements and monthly series. One call replaces dozens of per-day reads. The coverage block states the verified window; data before the configured start is not claimed.',
        inputSchema: {
          range: rangeSchema,
          includeToday: z.boolean().default(false),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (input) => {
        try {
          const result = await trainingOverview(env, {
            ...rangeInput(input.range),
            includeToday: input.includeToday,
          });
          const summary = `Overview ${result.range.from}..${result.range.to}: ${result.kpis.sessions} sessions, ${result.kpis.sets} sets, ${result.kpis.volumeKg} kg, ${result.kpis.durationHours ?? 0} h; ${coverageLine(result.coverage)}.`;
          return compactResult(result as unknown as Record<string, unknown>, summary);
        } catch (error) {
          return jsonResult({ status: 'error', error: failurePayload(error) }, true);
        }
      },
    );

    server.registerTool(
      'xunji_movement_progress',
      {
        title: 'Movement PR and progress',
        description:
          'For up to eight movements, returns best weight, best Epley estimated 1RM, PR timeline, monthly volume and a heuristic plateau flag. Estimated 1RM is annotated as an estimate, not a tested max. Use xunji_search_movements first if the exact Chinese name is unknown.',
        inputSchema: {
          movements: z.array(z.string().min(1)).min(1).max(8),
          range: rangeSchema,
          maxPrRows: z.number().int().min(1).max(20).default(12),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (input) => {
        try {
          const result = await movementProgress(env, {
            movements: input.movements,
            ...rangeInput(input.range),
            maxPrRows: input.maxPrRows,
          });
          const summary = `Progress: ${result.movements.length} movements; ${result.movements
            .map(
              (movement) =>
                `${movement.name}: best ${movement.bestWeightKg?.weight ?? 0}kg, e1RM ${movement.bestEst1rmKg?.value ?? 0}kg`,
            )
            .join('; ')}; ${coverageLine(result.coverage)}.`;
          return compactResult(result as unknown as Record<string, unknown>, summary);
        } catch (error) {
          return jsonResult({ status: 'error', error: failurePayload(error) }, true);
        }
      },
    );
  }

  /* ---------------------------------------------------------------- */
  /* Index coverage and backfill                                      */
  /* ---------------------------------------------------------------- */

  if (hasScanner) {
    server.registerTool(
      'xunji_history',
      {
        title: 'History index coverage and backfill',
        description:
          'Reports the derived index coverage (configured start, earliest verified day, earliest record, pending/error days, rate and ETA) and controls a resumable background backfill. action=backfill scans missing days from `start` to `end`; action=refresh re-reads a range and replaces changed/deleted source records; action=pause/resume controls the scanner. Backfill runs in a Durable Object alarm loop, not in this tool call.',
        inputSchema: {
          action: z
            .enum(['status', 'backfill', 'extend', 'refresh', 'pause', 'resume'])
            .default('status'),
          start: isoDate.optional(),
          end: isoDate.optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ action, start, end }) => {
        try {
          const today = todayInXunjiZone();
          const endDate = end ?? addDays(today, -1);
          const historyStart =
            (await getMeta<string>(env, 'history_start')) ?? env.HISTORY_START_DATE ?? null;

          if (action === 'pause') {
            await setScanPaused(env, true);
            const stub = env.SCAN_COORDINATOR!.get(
              env.SCAN_COORDINATOR!.idFromName('xunji-history'),
            );
            await stub.pause();
            return jsonResult(await historyStatus(env, endDate));
          }
          if (action === 'resume') {
            await setScanPaused(env, false);
            const stub = env.SCAN_COORDINATOR!.get(
              env.SCAN_COORDINATOR!.idFromName('xunji-history'),
            );
            await stub.resume();
            return jsonResult(await historyStatus(env, endDate));
          }

          if (action === 'status') {
            return compactResult(
              await historyStatus(env, endDate),
              `Index: ${await statusSummary(env, endDate)}`,
            );
          }

          const startDate =
            start ??
            historyStart ??
            env.HISTORY_START_DATE ??
            (await earliestRecord(env)) ??
            addDays(endDate, -365);
          if (startDate > endDate) {
            return jsonResult(
              {
                status: 'error',
                error: { code: 'invalid_range', message: '`start` must be on or before `end`.' },
              },
              true,
            );
          }
          const span =
            Math.round(
              (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) /
                86_400_000,
            ) + 1;
          if (span > 7320) {
            return jsonResult(
              {
                status: 'error',
                error: {
                  code: 'range_too_large',
                  message: 'At most 20 years per backfill request.',
                },
              },
              true,
            );
          }
          if (action === 'extend' && historyStart && startDate >= historyStart) {
            return jsonResult(
              {
                status: 'error',
                error: {
                  code: 'not_earlier',
                  message: `Extend start must be earlier than ${historyStart}.`,
                },
              },
              true,
            );
          }

          const before = await scanStatusCounts(env);
          await setHistoryStart(env, startDate);
          await setScanPaused(env, false);
          await setMeta(env, 'scan_baseline', before.complete + before.empty);
          await setMeta(env, 'scan_started_at', Date.now());
          const queued =
            action === 'refresh'
              ? await enqueueRefresh(env, startDate, endDate)
              : await enqueueRange(env, startDate, endDate);
          const stub = env.SCAN_COORDINATOR!.get(env.SCAN_COORDINATOR!.idFromName('xunji-history'));
          await stub.start(props.subject, action === 'refresh');

          return jsonResult({
            status: 'accepted',
            action,
            requested: { from: startDate, to: endDate, days: span, queued },
            message:
              action === 'refresh'
                ? 'Refresh queued. Changed and deleted source records are replaced transactionally per day.'
                : 'Backfill queued. It continues in the background; poll xunji_history with action=status.',
            index: await historyStatus(env, endDate),
          });
        } catch (error) {
          return jsonResult({ status: 'error', error: failurePayload(error) }, true);
        }
      },
    );
  }

  /* ---------------------------------------------------------------- */
  /* Optional domains: body and nutrition                              */
  /* ---------------------------------------------------------------- */

  const domains = (env.ENABLED_DATA_DOMAINS ?? 'train')
    .split(',')
    .map((value) => value.trim().toLowerCase());

  if (env.XUNJI_BODY_KEY && domains.includes('body')) {
    server.registerTool(
      'xunji_body_query',
      {
        title: 'Query body measurements',
        description:
          'Reads weight, body fat and circumference records for a date range from the separate Xunji body-data API. Requires the deployment to configure a body key. The response contract follows the official body skill; this deployment marks it unverified until a live response is observed.',
        inputSchema: {
          from: isoDate,
          to: isoDate,
          types: z
            .array(z.enum(BODY_TYPES as [string, ...string[]]))
            .max(15)
            .optional(),
          includeLatest: z.boolean().default(true),
          limit: z.number().int().min(1).max(1000).default(500),
          offset: z.number().int().min(0).default(0),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async (input) => {
        try {
          const result = await readBody(env, {
            from: input.from,
            to: input.to,
            types: input.types as never,
            includeLatest: input.includeLatest,
            includeRecords: true,
            limit: input.limit,
            offset: input.offset,
          });
          const payload = {
            status: 'ok',
            domain: 'body',
            from: input.from,
            to: input.to,
            records: result.records,
            latest: result.latest,
            retrieved: result.retrieved,
            verified: false,
            note: 'Contract from the official body skill; not live-verified in this deployment.',
          };
          return compactResult(
            payload,
            `Body: ${result.retrieved} records, ${Object.keys(result.byType).length} types.`,
          );
        } catch (error) {
          return jsonResult({ status: 'error', error: failurePayload(error) }, true);
        }
      },
    );
  }

  if (env.XUNJI_FOOD_KEY && domains.includes('nutrition')) {
    server.registerTool(
      'xunji_nutrition_query',
      {
        title: 'Query food records',
        description:
          'Reads food records for a date range from the separate Xunji food API. Requires the deployment to configure a food key. The response shape is normalized defensively; this deployment marks the domain unverified until a live response is observed.',
        inputSchema: {
          from: isoDate,
          to: isoDate,
          includeDetail: z.boolean().default(true),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async (input) => {
        try {
          const result = await readFoodRecords(env, input);
          return compactResult(
            {
              status: 'ok',
              domain: 'nutrition',
              from: input.from,
              to: input.to,
              records: result.records,
              retrieved: result.retrieved,
              verified: false,
            },
            `Nutrition: ${result.retrieved} records.`,
          );
        } catch (error) {
          return jsonResult({ status: 'error', error: failurePayload(error) }, true);
        }
      },
    );
  }

  if (env.XUNJI_FOOD_SEARCH_KEY && domains.includes('nutrition')) {
    server.registerTool(
      'xunji_search_foods',
      {
        title: 'Search official foods',
        description:
          'Searches the Xunji official food catalog by keyword and returns candidate names with nutrition fields. Requires the separate food-search key. Read-only; no record is created.',
        inputSchema: {
          keyword: z.string().min(1).max(40),
          limit: z.number().int().min(1).max(20).default(8),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async (input) => {
        try {
          const result = await searchFoods(env, input.keyword, input.limit);
          return compactResult(
            {
              status: 'ok',
              domain: 'nutrition',
              keyword: input.keyword,
              foods: result.foods,
              count: result.count,
              verified: false,
            },
            `Food search: ${result.count} candidates.`,
          );
        } catch (error) {
          return jsonResult({ status: 'error', error: failurePayload(error) }, true);
        }
      },
    );
  }
}

async function statusSummary(env: Env, endDate: string): Promise<string> {
  const counts = await scanStatusCounts(env);
  const historyStart =
    (await getMeta<string>(env, 'history_start')) ?? env.HISTORY_START_DATE ?? null;
  const coverage = historyStart ? await getCoverage(env, historyStart, endDate) : null;
  return coverage
    ? `${coverage.scannedDays}/${coverage.days} days scanned, ${counts.pending} pending, ${counts.error} errors`
    : `${counts.complete + counts.empty} days scanned; no history start configured`;
}

async function historyStatus(env: Env, endDate: string): Promise<Record<string, unknown>> {
  const historyStart =
    (await getMeta<string>(env, 'history_start')) ?? env.HISTORY_START_DATE ?? null;
  const counts = await scanStatusCounts(env);
  const coverage = historyStart ? await getCoverage(env, historyStart, endDate) : null;
  const contiguous = historyStart ? await contiguousVerifiedFrom(env, historyStart, endDate) : null;
  const paused = await isScanPaused(env);
  const startedAt = await getMeta<number>(env, 'scan_started_at');
  const baseline = (await getMeta<number>(env, 'scan_baseline')) ?? 0;
  const lastScanAt = await getMeta<number>(env, 'last_scan_at');
  const storedEarliest = await earliestRecord(env);
  const scanned = counts.complete + counts.empty;
  const elapsedMinutes = startedAt ? Math.max(0, (Date.now() - startedAt) / 60_000) : 0;
  const ratePerMinute =
    elapsedMinutes > 0 ? Math.max(0, (scanned - baseline) / elapsedMinutes) : null;
  const remaining = counts.pending + counts.error;
  const etaSeconds =
    ratePerMinute && ratePerMinute > 0 ? Math.round((remaining / ratePerMinute) * 60) : null;

  return {
    status: 'ok',
    history: {
      configuredStart: historyStart,
      earliestRecord: storedEarliest,
      earliestVerified: contiguous,
      latestScanned: coverage?.latestScanned ?? null,
      coverageComplete: coverage?.complete ?? false,
    },
    coverage,
    queue: {
      pending: counts.pending,
      error: counts.error,
      scanned,
      total: counts.total,
      ratePerMinute: ratePerMinute === null ? null : Math.round(ratePerMinute * 10) / 10,
      etaSeconds,
    },
    scanner: {
      paused,
      scanBudget: await scanBudgetStatus(env),
      kv: await kvWritesToday(env),
      running: !paused && counts.pending + counts.error > 0,
      startedAt: startedAt ?? null,
      lastScanAt: lastScanAt ?? null,
    },
    notes: [
      'The earliest record is the earliest indexed session. Earlier days are not claimed unless the configured start is before them and coverage is complete.',
      'Backfill respects the per-day vendor pacing; it is not a parallel bypass.',
    ],
  };
}

async function earliestRecord(env: Env): Promise<string | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare('SELECT MIN(datestr) AS earliest FROM session').first<{
    earliest: string | null;
  }>();
  return row?.earliest ?? null;
}
