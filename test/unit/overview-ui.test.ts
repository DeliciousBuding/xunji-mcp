import { env } from 'cloudflare:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import { OVERVIEW_UI_MIME, OVERVIEW_UI_URI } from '../../src/mcp/overview-ui';
import { buildServer } from '../../src/mcp/tools';
import type { AuthProps, Env } from '../../src/types';
import { SCOPES } from '../../src/types';

const baseEnv = env as unknown as Env;
const props: AuthProps = { subject: 'subject-test', label: 'operator', scope: [SCOPES.read] };

async function withClient<T>(testEnv: Env, run: (client: Client) => Promise<T>): Promise<T> {
  const server = buildServer({ env: testEnv, props });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'vitest', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

function uiEnv(enabled: boolean): Env {
  return { ...baseEnv, DB: baseEnv.DB, MCP_UI_ENABLED: enabled ? 'true' : 'false' };
}

describe('MCP Apps overview view', () => {
  it('is absent unless explicitly enabled', async () => {
    const result = await withClient(uiEnv(false), async (client) => ({
      resources: await client.listResources().then(
        (result) => result.resources,
        () => [],
      ),
      tool: (await client.listTools()).tools.find(
        (tool) => tool.name === 'xunji_training_overview',
      ),
    }));
    expect(result.resources.map((resource) => resource.uri)).not.toContain(OVERVIEW_UI_URI);
    expect(result.tool?._meta).toBeUndefined();
  });

  it('serves one sandboxed HTML resource and links it from the overview tool', async () => {
    const result = await withClient(uiEnv(true), async (client) => {
      const listed = (await client.listResources()).resources;
      const read = await client.readResource({ uri: OVERVIEW_UI_URI });
      const tool = (await client.listTools()).tools.find(
        (candidate) => candidate.name === 'xunji_training_overview',
      );
      return { listed, read, tool };
    });

    const resource = result.listed.find((entry) => entry.uri === OVERVIEW_UI_URI);
    expect(resource?.mimeType).toBe(OVERVIEW_UI_MIME);

    const content = result.read.contents[0];
    expect(content?.mimeType).toBe(OVERVIEW_UI_MIME);
    const html = content && 'text' in content ? content.text : '';
    expect(html).toContain('ui/initialize');
    expect(html).not.toMatch(/https?:\/\//);
    expect(result.tool?._meta).toMatchObject({
      ui: { resourceUri: OVERVIEW_UI_URI, visibility: ['model', 'app'] },
      'openai/outputTemplate': OVERVIEW_UI_URI,
    });
  });
});
