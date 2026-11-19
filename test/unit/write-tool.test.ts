/**
 * Write-path safety tests. These never touch a real Xunji account: every
 * upstream call is answered by a stub in this file.
 */

import { env } from 'cloudflare:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildServer } from '../../src/mcp/tools';
import type { AuthProps, Env } from '../../src/types';
import { SCOPES } from '../../src/types';

const readProps: AuthProps = { subject: 'subject-read', label: 'operator', scope: [SCOPES.read] };
const writeProps: AuthProps = {
  subject: 'subject-write',
  label: 'operator',
  scope: [SCOPES.read, SCOPES.write],
};

function testEnv(overrides: Partial<Env> = {}): Env {
  return { ...(env as unknown as Env), ...overrides };
}

async function callTool(
  toolEnv: Env,
  props: AuthProps,
  name: string,
  args: Record<string, unknown>,
  capture: { body?: string } = {},
) {
  const server = buildServer({ env: toolEnv, props });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'vitest', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({ name, arguments: args });
    return result as unknown as {
      isError?: boolean;
      structuredContent?: Record<string, unknown>;
    };
  } finally {
    await client.close();
    await server.close();
    void capture;
  }
}

const realFetch = globalThis.fetch;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubUpstream(reply: unknown, captured: { body?: string } = {}) {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/api_upsert_trains_for_llm_v2')) {
      captured.body = typeof init?.body === 'string' ? init.body : '';
      return Response.json(reply);
    }
    if (url.includes('/api_trains_for_llm_v2')) {
      captured.body = typeof init?.body === 'string' ? init.body : '';
      return Response.json(reply);
    }
    return realFetch(input, init);
  });
}

const validWrite = {
  date: '2026-11-18',
  confirmed: true as const,
  clientRequestId: 'vitest-write-0001',
  title: '合成写入',
  movements: [
    {
      name: '杠铃卧推',
      restTime: 90,
      sets: [{ weight: '60', unit: 'kg', reps: '8', done: true }],
    },
  ],
};

describe('write tool gating', () => {
  it('is not registered when WRITE_TOOLS_ENABLED is false', async () => {
    const server = buildServer({
      env: testEnv({ WRITE_TOOLS_ENABLED: 'false' }),
      props: writeProps,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'vitest', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).not.toContain('xunji_upsert_training_day');
    await client.close();
    await server.close();
  });

  it('is not registered for a read-only token', async () => {
    const server = buildServer({ env: testEnv({ WRITE_TOOLS_ENABLED: 'true' }), props: readProps });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'vitest', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).not.toContain('xunji_upsert_training_day');
    await client.close();
    await server.close();
  });
});

describe('write tool payload', () => {
  it('never sends dry_run and forwards the idempotency key', async () => {
    const captured: { body?: string } = {};
    stubUpstream(
      {
        res: {
          datestr: '2026-11-18',
          trains: [
            { localid: 200000000002, datestr: '2026-11-18', title: '合成写入', movements: [] },
          ],
        },
      },
      captured,
    );

    const result = await callTool(
      testEnv({ WRITE_TOOLS_ENABLED: 'true' }),
      writeProps,
      'xunji_upsert_training_day',
      validWrite,
    );

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.status).toBe('written');
    const sent = JSON.parse(captured.body ?? '{}') as Record<string, unknown>;
    expect(sent).not.toHaveProperty('dry_run');
    expect(sent.client_request_id).toBe('vitest-write-0001');
    expect(sent.schema_version).toBe('train_open_api_v2');
    const res = sent.res as Array<Record<string, unknown>>;
    expect(res).toHaveLength(1);
    expect(res[0]!.localid).toBeUndefined();
  });

  it('refuses to write without confirmed: true', async () => {
    const captured: { body?: string } = {};
    stubUpstream({ res: { trains: [] } }, captured);
    const result = await callTool(
      testEnv({ WRITE_TOOLS_ENABLED: 'true' }),
      writeProps,
      'xunji_upsert_training_day',
      { ...validWrite, confirmed: false },
    );
    expect(result.isError).toBe(true);
    expect(captured.body).toBeUndefined();
  });

  it('refuses dates outside the six-month window', async () => {
    const captured: { body?: string } = {};
    stubUpstream({ res: { trains: [] } }, captured);
    const result = await callTool(
      testEnv({ WRITE_TOOLS_ENABLED: 'true' }),
      writeProps,
      'xunji_upsert_training_day',
      { ...validWrite, date: '2020-01-01' },
    );
    expect(result.isError).toBe(true);
    expect((result.structuredContent?.error as { code?: string }).code).toBe('date_out_of_range');
    expect(captured.body).toBeUndefined();
  });

  it('updates an existing session only when localid is supplied', async () => {
    const captured: { body?: string } = {};
    stubUpstream(
      {
        res: {
          datestr: '2026-11-18',
          trains: [{ localid: 123456, datestr: '2026-11-18', movements: [] }],
        },
      },
      captured,
    );
    await callTool(
      testEnv({ WRITE_TOOLS_ENABLED: 'true' }),
      writeProps,
      'xunji_upsert_training_day',
      {
        ...validWrite,
        localid: 123456,
      },
    );
    const sent = JSON.parse(captured.body ?? '{}') as { res: Array<Record<string, unknown>> };
    expect(sent.res[0]!.localid).toBe(123456);
  });
});
