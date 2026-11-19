/**
 * End-to-end OAuth 2.1 integration tests against the real Worker code in
 * workerd. No network: upstream Xunji calls are mocked by Miniflare.
 */

import { SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGIN = 'https://exercise.example.com';
const MCP_URL = `${ORIGIN}/mcp`;
const REDIRECT = 'https://client.example.com/cb';
const PASSPHRASE = 'test-passphrase-for-vitest';

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

interface RegisteredClient {
  client_id: string;
}

async function registerClient(): Promise<RegisteredClient> {
  const response = await SELF.fetch(`${ORIGIN}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'vitest client',
      redirect_uris: [REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  expect(response.status).toBeLessThan(300);
  return (await response.json()) as RegisteredClient;
}

function cookieFrom(response: Response): string {
  const list =
    typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  const single = list.length > 0 ? list : [response.headers.get('set-cookie') ?? ''];
  return single
    .filter(Boolean)
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

async function completeAuthFlow(): Promise<{
  accessToken: string;
  refreshToken?: string;
  clientId: string;
}> {
  const client = await registerClient();
  const verifier = 'verifier-'.padEnd(64, 'x');
  const challenge = await sha256Base64Url(verifier);

  const authorizeUrl = new URL(`${ORIGIN}/authorize`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', client.client_id);
  authorizeUrl.searchParams.set('redirect_uri', REDIRECT);
  authorizeUrl.searchParams.set('scope', 'xunji:read');
  authorizeUrl.searchParams.set('state', 'state-123');
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('resource', MCP_URL);

  const page = await SELF.fetch(authorizeUrl.toString(), { redirect: 'manual' });
  expect(page.status).toBe(200);
  expect(page.headers.get('x-frame-options')).toBe('DENY');
  const html = await page.text();
  expect(html).toContain('Allow');
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1];
  expect(handle).toBeTruthy();
  const cookie = cookieFrom(page);

  const form = new FormData();
  form.set('handle', handle!);
  form.set('decision', 'approve');
  form.set('scope', 'xunji:read');
  form.set('passphrase', PASSPHRASE);

  const approved = await SELF.fetch(`${ORIGIN}/authorize`, {
    method: 'POST',
    headers: { cookie },
    body: form,
    redirect: 'manual',
  });
  expect(approved.status).toBe(302);
  const location = approved.headers.get('location');
  expect(location).toBeTruthy();
  const redirect = new URL(location!);
  expect(redirect.origin + redirect.pathname).toBe(REDIRECT);
  expect(redirect.searchParams.get('state')).toBe('state-123');
  expect(redirect.searchParams.get('iss')).toBe(ORIGIN);
  const code = redirect.searchParams.get('code');
  expect(code).toBeTruthy();

  const tokenResponse = await SELF.fetch(`${ORIGIN}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code!,
      redirect_uri: REDIRECT,
      client_id: client.client_id,
      code_verifier: verifier,
      resource: MCP_URL,
    }),
  });
  expect(tokenResponse.status).toBe(200);
  const token = (await tokenResponse.json()) as { access_token: string; refresh_token?: string };
  expect(token.access_token).toBeTruthy();
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    clientId: client.client_id,
  };
}

async function mcpCall(token: string, body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(MCP_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  });
}

const realFetch = globalThis.fetch;
let upstreamReply: { body: unknown; status?: number; gzip?: boolean } | null = null;

beforeEach(() => {
  upstreamReply = null;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith('https://trains.xunjiapp.cn') || url.startsWith('https://api.xunjiapp.cn')) {
      if (!upstreamReply) return new Response('no mock', { status: 500 });
      const payload = JSON.stringify(upstreamReply.body);
      if (upstreamReply.gzip) {
        const stream = new Blob([payload]).stream().pipeThrough(new CompressionStream('gzip'));
        return new Response(stream, {
          status: upstreamReply.status ?? 200,
          headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
        });
      }
      return new Response(payload, {
        status: upstreamReply.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return realFetch(input, init);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockUpstream(body: unknown, gzip = false) {
  upstreamReply = { body, gzip };
}

describe('OAuth discovery', () => {
  it('serves RFC 9728 protected resource metadata with the canonical resource', async () => {
    const response = await SELF.fetch(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.resource).toBe(MCP_URL);
    expect(body.authorization_servers).toEqual([ORIGIN]);
  });

  it('advertises S256, PKCE and issuer identification', async () => {
    const response = await SELF.fetch(`${ORIGIN}/.well-known/oauth-authorization-server`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.issuer).toBe(ORIGIN);
    expect(body.code_challenge_methods_supported).toContain('S256');
    expect(body.authorization_response_iss_parameter_supported).toBe(true);
    expect(body.resource).toBeUndefined();
    expect(JSON.stringify(body)).toContain(MCP_URL);
  });

  it('rejects an unauthenticated MCP request with a metadata challenge', async () => {
    const response = await SELF.fetch(MCP_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(401);
    const challenge = response.headers.get('www-authenticate') ?? '';
    expect(challenge).toContain('resource_metadata=');
    expect(challenge).toContain('oauth-protected-resource');
    expect(challenge).toContain('xunji:read');
  });
});

describe('authorization page', () => {
  it('fails closed when the passphrase is wrong', async () => {
    const client = await registerClient();
    const challenge = await sha256Base64Url('verifier-'.padEnd(64, 'x'));
    const url = new URL(`${ORIGIN}/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', client.client_id);
    url.searchParams.set('redirect_uri', REDIRECT);
    url.searchParams.set('scope', 'xunji:read');
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('resource', MCP_URL);

    const page = await SELF.fetch(url.toString(), { redirect: 'manual' });
    const html = await page.text();
    const handle = /name="handle" value="([^"]+)"/.exec(html)![1]!;
    const cookie = cookieFrom(page);

    const form = new FormData();
    form.set('handle', handle);
    form.set('decision', 'approve');
    form.set('scope', 'xunji:read');
    form.set('passphrase', 'wrong');

    const denied = await SELF.fetch(`${ORIGIN}/authorize`, {
      method: 'POST',
      headers: { cookie },
      body: form,
      redirect: 'manual',
    });
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain('code=');
  });

  it('refuses a request for an unregistered redirect URI', async () => {
    const client = await registerClient();
    const url = new URL(`${ORIGIN}/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', client.client_id);
    url.searchParams.set('redirect_uri', 'https://attacker.example.net/cb');
    url.searchParams.set('scope', 'xunji:read');
    url.searchParams.set('code_challenge', 'challenge');
    url.searchParams.set('code_challenge_method', 'S256');

    const response = await SELF.fetch(url.toString(), { redirect: 'manual' });
    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
  });
});

describe('token lifecycle', () => {
  it('rotates refresh tokens and accepts the new access token', async () => {
    const { accessToken, refreshToken, clientId } = await completeAuthFlow();
    expect(refreshToken).toBeTruthy();

    const refreshed = await SELF.fetch(`${ORIGIN}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken!,
        client_id: clientId,
        resource: MCP_URL,
      }),
    });
    expect(refreshed.status).toBe(200);
    const body = (await refreshed.json()) as { access_token: string; refresh_token?: string };
    expect(body.access_token).toBeTruthy();
    expect(body.access_token).not.toBe(accessToken);
    expect(body.refresh_token).toBeTruthy();
    expect(body.refresh_token).not.toBe(refreshToken);
  });

  it('rejects a token request with the wrong PKCE verifier', async () => {
    const client = await registerClient();
    const verifier = 'verifier-'.padEnd(64, 'x');
    const challenge = await sha256Base64Url(verifier);
    const authorizeUrl = new URL(`${ORIGIN}/authorize`);
    for (const [key, value] of Object.entries({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      scope: 'xunji:read',
      state: 's',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: MCP_URL,
    })) {
      authorizeUrl.searchParams.set(key, value);
    }
    const page = await SELF.fetch(authorizeUrl.toString(), { redirect: 'manual' });
    const html = await page.text();
    const handle = /name="handle" value="([^"]+)"/.exec(html)![1]!;
    const cookie = cookieFrom(page);
    const form = new FormData();
    form.set('handle', handle);
    form.set('decision', 'approve');
    form.set('scope', 'xunji:read');
    form.set('passphrase', PASSPHRASE);
    const approved = await SELF.fetch(`${ORIGIN}/authorize`, {
      method: 'POST',
      headers: { cookie },
      body: form,
      redirect: 'manual',
    });
    const code = new URL(approved.headers.get('location')!).searchParams.get('code')!;

    const response = await SELF.fetch(`${ORIGIN}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: client.client_id,
        code_verifier: 'wrong-verifier'.padEnd(64, 'y'),
        resource: MCP_URL,
      }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain('invalid_grant');
  });
});

describe('MCP endpoint', () => {
  it('rejects a forged bearer token', async () => {
    const response = await mcpCall('forged:grant:token', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    expect(response.status).toBe(401);
  });

  it('completes an OAuth code + PKCE flow and lists tools', async () => {
    const { accessToken } = await completeAuthFlow();

    const list = await mcpCall(accessToken, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      result?: { tools?: Array<{ name: string; annotations?: Record<string, unknown> }> };
    };
    const names = (body.result?.tools ?? []).map((tool) => tool.name);
    expect(names).toContain('xunji_get_training_day');
    expect(names).toContain('xunji_training_stats');
    expect(names).toContain('xunji_search_movements');
    expect(names).not.toContain('xunji_upsert_training_day');

    const readOnly = body.result?.tools?.find((tool) => tool.name === 'xunji_get_training_day');
    expect(readOnly?.annotations?.readOnlyHint).toBe(true);
    expect(readOnly?.annotations?.destructiveHint).toBe(false);
  });

  it('returns a synthetic training day with computed aggregates', async () => {
    const { accessToken } = await completeAuthFlow();

    mockUpstream({ res: FIXTURE_RES });

    const response = await mcpCall(accessToken, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'xunji_get_training_day', arguments: { date: '2026-11-17' } },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result?: { structuredContent?: { status?: string; totals?: { totalVolumeKg?: number } } };
    };
    expect(body.result?.structuredContent?.status).toBe('recorded');
    expect(body.result?.structuredContent?.totals?.totalVolumeKg).toBe(680);
  });

  it('reports an empty day as success, not an error', async () => {
    const { accessToken } = await completeAuthFlow();
    mockUpstream({ res: { datestr: '2026-11-15', trains: [], truncated: false } });

    const response = await mcpCall(accessToken, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'xunji_get_training_day', arguments: { date: '2026-11-15' } },
    });
    const body = (await response.json()) as {
      result?: { isError?: boolean; structuredContent?: { status?: string } };
    };
    expect(body.result?.isError).toBeUndefined();
    expect(body.result?.structuredContent?.status).toBe('no_training');
  });

  it('maps the vendor soft rate limit to a typed, retryable error', async () => {
    const { accessToken } = await completeAuthFlow();
    mockUpstream({ success: false, res: 'too frequent, retry after 30s' });

    const response = await mcpCall(accessToken, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'xunji_get_training_day', arguments: { date: '2026-11-12' } },
    });
    const body = (await response.json()) as {
      result?: {
        isError?: boolean;
        structuredContent?: { status?: string; reason?: string; retryAfterSeconds?: number };
      };
    };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.structuredContent?.status).toBe('deferred');
    expect(body.result?.structuredContent?.retryAfterSeconds).toBe(30);
  });
});

const FIXTURE_RES = {
  schema: 'train_open_api_v2',
  datestr: '2026-11-17',
  limits: {
    readRateLimitSecondsLight: 15,
    readRateLimitSecondsFull: 30,
    writeRateLimitSeconds: 45,
  },
  truncated: false,
  trains: [
    {
      localid: 100000000001,
      datestr: '2026-11-17',
      title: '合成样例·胸',
      note: 'calorie:290',
      start: 1794902201183,
      end: 1794907544907,
      movements: [
        {
          index: 1,
          name: '杠铃卧推',
          type: '胸',
          sets: [
            { index: 1, done: true, weight: '20', unit: 'kg', reps: '10' },
            { index: 2, done: true, weight: '60', unit: 'kg', reps: '8' },
            { index: 3, done: false, weight: '60', unit: 'kg', reps: '8' },
          ],
        },
      ],
      truncated: false,
    },
  ],
};
