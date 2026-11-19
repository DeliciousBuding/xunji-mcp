/**
 * Operator-only index controls.
 *
 * The MCP tool is the normal path. This endpoint exists so an operator can
 * start or inspect a long backfill from CI or a shell without holding an OAuth
 * token, and without a browser. It returns counts only — never training data.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { secretsMatch } from './auth/identity';
import { buildServer } from './mcp/tools';
import { addDays, todayInXunjiZone } from './domain/date';
import {
  enqueueRange,
  enqueueRefresh,
  getCoverage,
  getMeta,
  isScanPaused,
  scanBudgetStatus,
  scanStatusCounts,
  setHistoryStart,
  setMeta,
} from './index/store';
import { kvWritesToday } from './kv-budget';
import type { Env } from './types';

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function handleAdmin(request: Request, env: Env): Promise<Response> {
  const expected = env.ADMIN_TOKEN?.trim();
  if (!expected) return new Response('Not found', { status: 404 });

  const header = request.headers.get('authorization') ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!(await secretsMatch(supplied, expected))) {
    return new Response('Unauthorized', { status: 401, headers: { 'www-authenticate': 'Bearer' } });
  }

  const url = new URL(request.url);
  if (url.pathname === '/admin/index' && request.method === 'GET') {
    return json(await indexStatus(env));
  }

  if (url.pathname === '/admin/tools' && request.method === 'GET') {
    const server = buildServer({
      env,
      props: { subject: 'admin-check', label: 'admin', scope: ['xunji:read'] },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'admin-check', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const tools = await client.listTools();
      return json({
        count: tools.tools.length,
        tools: tools.tools.map((tool) => ({
          name: tool.name,
          annotations: tool.annotations ?? null,
        })),
      });
    } finally {
      await client.close();
      await server.close();
    }
  }

  if (url.pathname === '/admin/backfill' && request.method === 'POST') {
    if (!env.DB || !env.SCAN_COORDINATOR) return json({ error: 'index_unavailable' }, 503);
    const body = (await request.json().catch(() => ({}))) as {
      start?: string;
      end?: string;
      refresh?: boolean;
    };
    const today = todayInXunjiZone();
    const end = body.end ?? addDays(today, -1);
    const start = body.start ?? (await getMeta<string>(env, 'history_start')) ?? addDays(end, -365);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
      return json({ error: 'invalid_range' }, 400);
    }
    const span =
      Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) +
      1;
    if (span > 7320) return json({ error: 'range_too_large' }, 400);

    await setHistoryStart(env, start);
    await setMeta(env, 'scan_started_at', Date.now());
    const before = await scanStatusCounts(env);
    await setMeta(env, 'scan_baseline', before.complete + before.empty);
    const queued = body.refresh
      ? await enqueueRefresh(env, start, end)
      : await enqueueRange(env, start, end);
    await env.SCAN_COORDINATOR.get(env.SCAN_COORDINATOR.idFromName('xunji-history')).start(
      'operator-index',
      body.refresh === true,
    );
    return json({ accepted: true, start, end, queued, status: await indexStatus(env) });
  }

  return new Response('Not found', { status: 404 });
}

async function indexStatus(env: Env): Promise<Record<string, unknown>> {
  const historyStart =
    (await getMeta<string>(env, 'history_start')) ?? env.HISTORY_START_DATE ?? null;
  const today = todayInXunjiZone();
  const counts = await scanStatusCounts(env);
  const coverage = historyStart ? await getCoverage(env, historyStart, addDays(today, -1)) : null;
  const earliest = env.DB
    ? await env.DB.prepare('SELECT MIN(datestr) AS d FROM session').first<{ d: string | null }>()
    : null;
  return {
    historyStart,
    earliestRecord: earliest?.d ?? null,
    counts,
    coverage: coverage
      ? {
          complete: coverage.complete,
          days: coverage.days,
          scannedDays: coverage.scannedDays,
          pendingDays: coverage.pendingDays,
          errorDays: coverage.errorDays,
          latestScanned: coverage.latestScanned,
        }
      : null,
    paused: await isScanPaused(env),
    scanBudget: await scanBudgetStatus(env),
    kv: await kvWritesToday(env),
    updatedAt: Date.now(),
  };
}
