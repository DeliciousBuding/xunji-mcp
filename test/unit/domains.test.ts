import { env } from 'cloudflare:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { capabilityMatrix } from '../../src/capabilities';
import { buildServer } from '../../src/mcp/tools';
import { readBody, readFoodRecords, searchFoods } from '../../src/upstream/domains';
import type { AuthProps, Env } from '../../src/types';
import { SCOPES } from '../../src/types';

const baseEnv = env as unknown as Env;
const props: AuthProps = { subject: 'subject-test', label: 'operator', scope: [SCOPES.read] };
const realFetch = globalThis.fetch;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stub(body: unknown): void {
  vi.stubGlobal('fetch', async () =>
    Response.json(body, { headers: { 'content-type': 'application/json' } }),
  );
}

describe('body adapter', () => {
  it('normalizes records and latest values without inventing units', async () => {
    stub({
      success: true,
      res: {
        records: [
          { datestr: '2026-11-18', type: 'weight', value: 72.4, unit: 'kg', label: '体重' },
          { datestr: '2026-11-18', type: 'bodyfat', value: 18.2, unit: '%', label: '体脂率' },
        ],
        latest: { weight: { datestr: '2026-11-18', type: 'weight', value: 72.4 } },
      },
    });
    const result = await readBody(
      { ...baseEnv, XUNJI_BODY_KEY: 'test-body' },
      { from: '2026-11-01', to: '2026-11-18' },
    );
    expect(result.retrieved).toBe(2);
    expect(result.latest.weight?.value).toBe(72.4);
    expect(result.byType.bodyfat?.[0]?.unit).toBe('%');
  });

  it('refuses to run without the body key', async () => {
    await expect(
      readBody({ ...baseEnv, XUNJI_BODY_KEY: undefined }, { from: '2026-11-01', to: '2026-11-18' }),
    ).rejects.toMatchObject({ code: 'not_configured' });
  });
});

describe('nutrition adapters', () => {
  it('keeps documented nutrient fields and ignores unknown text', async () => {
    stub({
      success: true,
      res: {
        records: [
          {
            date: '2026-11-18',
            meal_type: 'lunch',
            name: '鸡胸肉',
            amount: 150,
            unit: 'g',
            cal: 165,
            protein: 31,
            fat: 3.6,
            carb: 0,
          },
        ],
      },
    });
    const result = await readFoodRecords(
      { ...baseEnv, XUNJI_FOOD_KEY: 'test-food' },
      { from: '2026-11-18', to: '2026-11-18' },
    );
    expect(result.records[0]).toMatchObject({ name: '鸡胸肉', calories: 165, protein: 31 });
  });

  it('rejects an unrecognized response shape instead of dumping it', async () => {
    stub({ success: true, res: { unexpected: [] } });
    await expect(
      readFoodRecords(
        { ...baseEnv, XUNJI_FOOD_KEY: 'test-food' },
        { from: '2026-11-18', to: '2026-11-18' },
      ),
    ).rejects.toMatchObject({ code: 'bad_payload' });
  });

  it('maps the compressed search array defensively', async () => {
    stub({
      success: true,
      res: { foods: [{ name: '鸡蛋', uniquekey: 'k' }], d: [[1, '鸡蛋', 143]] },
    });
    const result = await searchFoods(
      { ...baseEnv, XUNJI_FOOD_SEARCH_KEY: 'test-search' },
      '鸡蛋',
      5,
    );
    expect(result.foods[0]?.name).toBe('鸡蛋');
  });
});

describe('capability matrix and tool gating', () => {
  it('marks unconfigured domains explicitly', () => {
    const rows = capabilityMatrix({
      ...baseEnv,
      XUNJI_BODY_KEY: undefined,
      XUNJI_FOOD_KEY: undefined,
    });
    expect(rows.find((row) => row.domain === 'body')?.status).toBe('unconfigured');
    expect(rows.find((row) => row.domain === 'nutrition')?.status).toBe('unconfigured');
    expect(rows.find((row) => row.capability === 'read one training day')?.verified).toBe(true);
  });

  it('registers query and history tools when the index is bound', async () => {
    const names = await listTools({
      ...baseEnv,
      DB: baseEnv.DB,
      SCAN_COORDINATOR: baseEnv.SCAN_COORDINATOR,
    });
    expect(names).toEqual(
      expect.arrayContaining([
        'xunji_query_training',
        'xunji_training_overview',
        'xunji_movement_progress',
        'xunji_history',
      ]),
    );
  });

  it('registers body tools only when the key is present', async () => {
    const without = await listTools({ ...baseEnv, XUNJI_BODY_KEY: undefined });
    expect(without).not.toContain('xunji_body_query');

    const withKey = await listTools({
      ...baseEnv,
      XUNJI_BODY_KEY: 'test-body',
      ENABLED_DATA_DOMAINS: 'train,body',
    });
    expect(withKey).toContain('xunji_body_query');
  });
});

async function listTools(testEnv: Env): Promise<string[]> {
  const server = buildServer({ env: testEnv, props });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'vitest', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.listTools();
    return result.tools.map((tool) => tool.name);
  } finally {
    await client.close();
    await server.close();
  }
}

void realFetch;
