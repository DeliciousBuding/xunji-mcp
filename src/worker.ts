/**
 * Cloudflare Worker entry point.
 *
 * Routes:
 * - `/mcp`                       MCP Streamable HTTP (OAuth-protected)
 * - `/oauth/*`, `/.well-known/*` OAuth endpoints served by workers-oauth-provider
 * - `/authorize`                 operator sign-in + consent page (application code)
 * - `/healthz`                   liveness: no data, no secrets
 *
 * The upstream Xunji key is a Worker secret and never leaves the Worker. An
 * OAuth token only proves that the allowlisted operator authorized a client;
 * it never contains or carries the Xunji key.
 */

import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

import { renderAuthorizePage, renderAuthorizeError } from './auth/authorize-page';
import {
  identityFromAccess,
  identityFromPassphrase,
  identityMode,
  passphraseConfigured,
  type OperatorIdentity,
} from './auth/identity';
import { buildServer } from './mcp/tools';
import { handleAdmin } from './admin';
import { VERSION } from './branding';
import { enqueueDailyGap } from './index/daily-refresh';
import type { AuthProps, Env } from './types';
import { SCOPES } from './types';

const SERVER_INFO = { name: 'xunji-mcp', version: VERSION } as const;

function writeEnabled(env: Env): boolean {
  return (env.WRITE_TOOLS_ENABLED ?? '').toLowerCase() === 'true';
}

export function allowedScopes(env: Env): string[] {
  const scopes: string[] = [SCOPES.read];
  if (writeEnabled(env)) scopes.push(SCOPES.write);
  return scopes;
}

export function requestedScopes(env: Env, requested: string[] | undefined): string[] {
  const allowed = allowedScopes(env);
  if (!requested || requested.length === 0) return [SCOPES.read];
  const granted = requested.filter((scope) => allowed.includes(scope));
  return granted.length > 0 ? granted : [SCOPES.read];
}

/* ------------------------------------------------------------------ */
/* MCP handler                                                         */
/* ------------------------------------------------------------------ */

export const mcpHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'POST') {
      return Response.json(
        { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null },
        { status: 405, headers: { allow: 'POST' } },
      );
    }

    const props = (ctx as ExecutionContext & { props?: AuthProps }).props;
    if (!props?.subject) {
      return Response.json(
        { jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized.' }, id: null },
        { status: 401 },
      );
    }

    const server = buildServer({ env, props });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: 32 * 1024,
    });

    const requestClone = request.clone();
    const requestText = await requestClone.text();
    const method = /"method"\s*:\s*"([^"]+)"/.exec(requestText)?.[1] ?? 'unknown';

    await server.connect(transport);
    try {
      const response = await transport.handleRequest(request);
      if (method === 'tools/list') {
        try {
          const body = (await response.clone().json()) as {
            result?: { tools?: Array<{ name: string }> };
          };
          const names = (body.result?.tools ?? []).map((tool) => tool.name);
          console.warn('tools_list', names.length, names.join(','));
        } catch {
          console.warn('tools_list', 'unparsed');
        }
      }
      return response;
    } finally {
      await transport.close();
      await server.close();
    }
  },
};

/* ------------------------------------------------------------------ */
/* Authorization page                                                  */
/* ------------------------------------------------------------------ */

async function operatorFromRequest(request: Request, env: Env): Promise<OperatorIdentity | null> {
  return identityFromAccess(request, env);
}

export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const mode = identityMode(env);

  if (mode === 'none') {
    return renderAuthorizeError(
      'This deployment is not configured for operator sign-in. Set ACCESS_TEAM_DOMAIN + ACCESS_AUD or OWNER_PASSPHRASE.',
      503,
    );
  }

  if (request.method === 'GET') {
    let authRequest;
    try {
      authRequest = await oauth.parseAuthRequest(request);
    } catch {
      return renderAuthorizeError('This authorization request is not valid for this server.', 400);
    }

    let details;
    try {
      details = await oauth.describeConsent(authRequest);
    } catch {
      return renderAuthorizeError('This client could not be verified for this server.', 400);
    }

    const operator = await operatorFromRequest(request, env);
    if (!operator && mode === 'cf-access' && !passphraseConfigured(env)) {
      return renderAuthorizeError(
        'Cloudflare Access did not provide an identity for this request. Open this page through the protected deployment URL.',
        403,
      );
    }

    const consent = await oauth.beginConsent(authRequest);
    consent.headers.set('content-type', 'text/html; charset=utf-8');
    consent.headers.set('cache-control', 'no-store');
    consent.headers.set('x-frame-options', 'DENY');
    consent.headers.set('referrer-policy', 'no-referrer');
    consent.headers.set(
      'content-security-policy',
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https:; frame-ancestors 'none'",
    );

    return new Response(
      renderAuthorizePage({
        details,
        handle: consent.handle,
        mode: operator ? 'cf-access' : 'passphrase',
        operatorLabel: operator?.label,
        requestedScopes: requestedScopes(env, authRequest.scope),
      }),
      { status: 200, headers: consent.headers },
    );
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, POST' } });
  }

  const form = await request.formData();
  const handle = String(form.get('handle') ?? '');
  const decision = String(form.get('decision') ?? '');

  let operator = await operatorFromRequest(request, env);
  if (!operator && passphraseConfigured(env)) {
    operator = await identityFromPassphrase(String(form.get('passphrase') ?? ''), env);
  }
  if (!operator) {
    return renderAuthorizeError('Sign-in failed. No grant was created.', 403);
  }

  if (decision !== 'approve') {
    try {
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    } catch {
      return renderAuthorizeError(
        'This consent request expired. Start again from your MCP client.',
        400,
      );
    }
  }

  const formScopes = form
    .getAll('scope')
    .map(String)
    .filter((scope) => allowedScopes(env).includes(scope));

  try {
    const approved = await oauth.approveConsent(request, handle, {
      scope: formScopes.length > 0 ? formScopes : [SCOPES.read],
    });

    const granted = approved.request.scope.length > 0 ? approved.request.scope : [SCOPES.read];
    const props: AuthProps = {
      subject: operator.subject,
      label: operator.label,
      scope: granted,
    };

    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: operator.subject,
      metadata: { label: operator.label, method: operator.method },
      scope: granted,
      props,
    });

    approved.headers.set('location', redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (error) {
    console.warn('approve_failed', (error as Error).name, (error as Error).message);
    return renderAuthorizeError(
      'This consent request expired or was already used. Start again from your MCP client.',
      400,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Health                                                              */
/* ------------------------------------------------------------------ */

export function handleHealth(env: Env): Response {
  const mode = identityMode(env);
  const body = {
    status: 'ok',
    server: SERVER_INFO.name,
    version: SERVER_INFO.version,
    identityMode: mode,
    configured: {
      upstreamKey: Boolean(env.XUNJI_API_KEY),
      operatorGate: mode !== 'none',
      allowlistEntries: (env.ALLOWED_USER_EMAILS ?? '').split(',').filter(Boolean).length,
      index: Boolean(env.DB),
      scanner: Boolean(env.SCAN_COORDINATOR),
      mcpUi: (env.MCP_UI_ENABLED ?? '').toLowerCase() === 'true',
    },
    writeToolsEnabled: writeEnabled(env),
  };
  return Response.json(body, {
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

/* ------------------------------------------------------------------ */
/* Default handler                                                     */
/* ------------------------------------------------------------------ */

const defaultHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/healthz') return handleHealth(env);
    if (url.pathname.startsWith('/admin/')) return handleAdmin(request, env);
    if (url.pathname === '/authorize') return handleAuthorize(request, env);

    if (url.pathname === '/' || url.pathname === '') {
      const origin = escapeHtml(env.PUBLIC_ORIGIN);
      const path = escapeHtml(env.MCP_RESOURCE_PATH);
      return new Response(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>xunji-mcp</title>
<style>body{font:15px/1.6 system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1.2rem}code{background:#8882;padding:.1rem .3rem;border-radius:4px}</style>
<h1>xunji-mcp</h1>
<p>A self-hosted Model Context Protocol bridge for Xunji (训记) training data.</p>
<p>MCP endpoint: <code>${origin}${path}</code></p>
<p><a href="/healthz">health</a></p>`,
        { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
      );
    }

    return new Response('Not found', { status: 404 });
  },
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

/**
 * The provider's metadata is static, but the canonical origin is deployment
 * configuration. Cache one provider per origin so the same code works for a
 * custom domain, a preview URL and `wrangler dev`.
 */
const providers = new Map<string, OAuthProvider<Env>>();

function providerFor(env: Env): OAuthProvider<Env> {
  const origin = env.PUBLIC_ORIGIN;
  const cached = providers.get(origin);
  if (cached) return cached;

  const provider = new OAuthProvider<Env>({
    apiRoute: env.MCP_RESOURCE_PATH,
    apiHandler: mcpHandler,
    defaultHandler,
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/oauth/token',
    // Kept for clients that do not implement CIMD yet; CIMD is preferred.
    clientRegistrationEndpoint: '/oauth/register',
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: [SCOPES.read, SCOPES.write, 'offline_access'],
    resourceMetadata: {
      resource: `${origin}${env.MCP_RESOURCE_PATH}`,
      authorization_servers: [origin],
      resource_name: 'Xunji training data (xunji-mcp)',
      bearer_methods_supported: ['header'],
    },
    requiredScopes: [SCOPES.read],
    accessTokenTTL: 3600,
    refreshTokenTTL: 30 * 24 * 3600,
    refreshTokenIdleTTL: 30 * 24 * 3600,
    clientRegistrationTTL: 90 * 24 * 3600,
  });
  providers.set(origin, provider);
  return provider;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return providerFor(env).fetch(request, env, ctx);
  },

  /**
   * Keeps the indexed tail current. A no-op until the operator has set a
   * history start and there is a gap to fill.
   */
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const gap = await enqueueDailyGap(env);
    if (!gap || gap.enqueued === 0 || !env.SCAN_COORDINATOR) return;
    await env.SCAN_COORDINATOR.get(env.SCAN_COORDINATOR.idFromName('xunji-history')).start(
      'operator-index',
      true,
    );
  },
} satisfies ExportedHandler<Env>;

export { UpstreamGate } from './gate';
export { ScanCoordinator } from './index/scan-coordinator';
