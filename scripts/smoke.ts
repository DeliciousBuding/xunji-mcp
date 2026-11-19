#!/usr/bin/env node
/// <reference types="node" />
/**
 * Production smoke test.
 *
 *   BASE_URL=https://your-domain.example node scripts/smoke.ts
 *   BASE_URL=... OWNER_PASSPHRASE=... node scripts/smoke.ts --oauth
 *
 * Checks:
 * 1. /healthz shape (booleans only)
 * 2. RFC 9728 metadata at the canonical resource path
 * 3. RFC 8414 metadata: issuer, S256, iss support
 * 4. 401 + WWW-Authenticate challenge on /mcp
 * 5. Optional: full authorization-code + PKCE flow, then tools/list
 *
 * Never prints tokens, secrets or training data.
 */

const BASE = (process.env.BASE_URL ?? '').replace(/\/$/, '');
if (!BASE) {
  console.error('BASE_URL is required');
  process.exit(2);
}
const withOauth = process.argv.includes('--oauth');
const passphrase = process.env.OWNER_PASSPHRASE ?? '';
const accessJwt = process.env.ACCESS_JWT ?? '';
const resource = `${BASE}/mcp`;

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
function record(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
function skip(name: string, detail: string): void {
  console.log(`SKIP  ${name} — ${detail}`);
}

async function json(url: string): Promise<{ response: Response; body: any }> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  return { response, body: await response.json().catch(() => null) };
}

const health = await json(`${BASE}/healthz`);
record(
  'healthz',
  health.response.ok &&
    health.body?.status === 'ok' &&
    health.body?.configured?.upstreamKey === true,
  `identityMode=${health.body?.identityMode} upstreamKey=${health.body?.configured?.upstreamKey}`,
);

const prm = await json(`${BASE}/.well-known/oauth-protected-resource/mcp`);
record(
  'protected resource metadata',
  prm.response.ok &&
    prm.body?.resource === resource &&
    Array.isArray(prm.body?.authorization_servers),
  `resource=${prm.body?.resource}`,
);

const as = await json(`${BASE}/.well-known/oauth-authorization-server`);
record(
  'authorization server metadata',
  as.response.ok &&
    as.body?.issuer === BASE &&
    (as.body?.code_challenge_methods_supported ?? []).includes('S256') &&
    as.body?.authorization_response_iss_parameter_supported === true,
  `issuer=${as.body?.issuer}`,
);

const unauthenticated = await fetch(resource, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
});
const challenge = unauthenticated.headers.get('www-authenticate') ?? '';
record(
  '401 challenge',
  unauthenticated.status === 401 &&
    challenge.includes('resource_metadata=') &&
    challenge.includes('xunji:read'),
  `status=${unauthenticated.status}`,
);

if (withOauth) {
  if (!passphrase) {
    console.error('--oauth requires OWNER_PASSPHRASE');
    process.exit(2);
  }
  const registration = await fetch(`${BASE}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'xunji-mcp smoke',
      redirect_uris: ['https://client.example.com/cb'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  const client: any = await registration.json();
  record('dynamic client registration', registration.ok && Boolean(client.client_id));

  const verifier = 'smoke-verifier-' + 'x'.repeat(48);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challengeValue = Buffer.from(digest).toString('base64url');
  const authorize = new URL(`${BASE}/authorize`);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', client.client_id);
  authorize.searchParams.set('redirect_uri', 'https://client.example.com/cb');
  authorize.searchParams.set('scope', 'xunji:read');
  authorize.searchParams.set('code_challenge', challengeValue);
  authorize.searchParams.set('code_challenge_method', 'S256');
  authorize.searchParams.set('resource', resource);

  const authHeaders: Record<string, string> = accessJwt
    ? { 'cf-access-jwt-assertion': accessJwt }
    : {};
  const page = await fetch(authorize, { redirect: 'manual', headers: authHeaders });
  if (page.status === 403 || page.status === 302) {
    const location = page.headers.get('location') ?? '';
    skip(
      'authorization page',
      location.includes('cloudflareaccess.com')
        ? 'behind Cloudflare Access; complete the browser flow or pass ACCESS_JWT'
        : `HTTP ${page.status}; complete the flow in a browser`,
    );
  } else {
    const html = await page.text();
    const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1];
    const cookie = (page.headers.getSetCookie?.() ?? [])
      .map((value) => value.split(';')[0])
      .join('; ');
    record('authorization page', page.ok && Boolean(handle));

    if (handle) {
      const form = new URLSearchParams({
        handle,
        decision: 'approve',
        scope: 'xunji:read',
        passphrase,
      });
      const approved = await fetch(`${BASE}/authorize`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', ...authHeaders },
        body: form,
      });
      const location = approved.headers.get('location') ?? '';
      const code = location.includes('code=') ? new URL(location).searchParams.get('code') : null;
      record('consent approval', approved.status === 302 && Boolean(code));

      if (code) {
        const tokenResponse = await fetch(`${BASE}/oauth/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: 'https://client.example.com/cb',
            client_id: client.client_id,
            code_verifier: verifier,
            resource,
          }),
        });
        const token: any = await tokenResponse.json();
        record('token exchange', tokenResponse.ok && Boolean(token.access_token));

        if (token.access_token) {
          const list = await fetch(resource, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${token.access_token}`,
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
          });
          const body: any = await list.json().catch(() => null);
          const names = (body?.result?.tools ?? []).map((tool: { name: string }) => tool.name);
          record(
            'authenticated tools/list',
            list.ok &&
              names.includes('xunji_get_training_day') &&
              !names.includes('xunji_upsert_training_day'),
            `${names.length} tools, read-only`,
          );
        }
      }
    }
  }
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);

export {};
