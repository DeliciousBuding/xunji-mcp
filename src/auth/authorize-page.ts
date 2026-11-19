/** Server-rendered authorization page. No client-side JavaScript. */

import type { ConsentDescription } from '@cloudflare/workers-oauth-provider';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLE = `
  :root { color-scheme: light dark; }
  body { font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; max-width: 34rem; margin: 3rem auto; padding: 0 1.2rem; }
  h1 { font-size: 1.35rem; margin-bottom: .2rem; }
  .muted { color: #666; }
  .card { border: 1px solid #8884; border-radius: 10px; padding: 1rem 1.1rem; margin: 1.2rem 0; }
  dl { display: grid; grid-template-columns: 8rem 1fr; gap: .35rem .8rem; margin: 0; }
  dt { color: #666; }
  dd { margin: 0; overflow-wrap: anywhere; }
  label { display: block; margin: .35rem 0; }
  input[type=password] { width: 100%; padding: .5rem; font: inherit; }
  button { font: inherit; padding: .55rem 1.1rem; border-radius: 8px; border: 1px solid #8886; cursor: pointer; }
  button.primary { background: #1a6; color: #fff; border-color: #1a6; }
  .warn { background: #fdd6; border: 1px solid #e88; padding: .6rem .8rem; border-radius: 8px; }
  .actions { display: flex; gap: .6rem; margin-top: 1rem; }
  code { background: #8882; padding: .1rem .3rem; border-radius: 4px; }
`;

export interface AuthorizePageOptions {
  details: ConsentDescription;
  handle: string;
  mode: 'cf-access' | 'passphrase';
  operatorLabel?: string;
  requestedScopes: string[];
}

export function renderAuthorizePage(options: AuthorizePageOptions): string {
  const { details, handle, mode, operatorLabel } = options;
  const clientName = escapeHtml(details.clientName || 'Unknown client');
  const redirectHost = escapeHtml(details.redirectHost || 'unknown host');

  const clientOrigin = details.clientDomain
    ? `<p class="muted">Published by <strong>${escapeHtml(details.clientDomain)}</strong>.</p>`
    : `<p class="muted">This client registered itself; its name is not independently verified.</p>`;

  const loopbackWarning = details.redirectIsLoopback
    ? `<p class="warn">This authorization returns access to an app on your own computer. Continue only if you just started connecting from it.</p>`
    : '';

  const scopes = (details.scope.length > 0 ? details.scope : ['xunji:read'])
    .map((scope) => {
      const checked = options.requestedScopes.includes(scope) ? ' checked' : '';
      return `<label><input type="checkbox" name="scope" value="${escapeHtml(scope)}"${checked}> <code>${escapeHtml(scope)}</code></label>`;
    })
    .join('');

  const identityBlock =
    mode === 'passphrase'
      ? `<div class="card">
           <label for="passphrase">Deployment passphrase</label>
           <input id="passphrase" name="passphrase" type="password" autocomplete="current-password" required>
           <p class="muted">Only the operator who deployed this bridge can approve access.</p>
         </div>`
      : `<p class="muted">Signed in via Cloudflare Access${operatorLabel ? ` as <strong>${escapeHtml(operatorLabel)}</strong>` : ''}.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Authorize ${clientName} · xunji-mcp</title>
<style>${STYLE}</style>
</head>
<body>
<h1>Allow ${clientName} to read your Xunji training data?</h1>
${clientOrigin}
${loopbackWarning}
<div class="card">
  <dl>
    <dt>Client</dt><dd>${clientName}</dd>
    <dt>Access goes to</dt><dd><strong>${redirectHost}</strong></dd>
    <dt>Data</dt><dd>Training records from your own Xunji account</dd>
    <dt>Can write?</dt><dd>${scopes.includes('xunji:write') ? 'Only if the write scope is granted and enabled' : 'No — read-only'}</dd>
  </dl>
</div>
<form method="post" action="/authorize" autocomplete="off">
  <input type="hidden" name="handle" value="${escapeHtml(handle)}">
  <fieldset style="border:0;padding:0;margin:0">
    <legend class="muted">Scopes</legend>
    ${scopes}
  </fieldset>
  ${identityBlock}
  <div class="actions">
    <button class="primary" type="submit" name="decision" value="approve">Allow</button>
    <button type="submit" name="decision" value="deny">Deny</button>
  </div>
</form>
<p class="muted" style="margin-top:1.5rem">
  This bridge stores only OAuth grants and a short-lived read cache. Your Xunji API key stays on the server.
</p>
</body>
</html>`;
}

export function renderAuthorizeError(message: string, status: number): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Authorization error · xunji-mcp</title>
<style>${STYLE}</style></head>
<body><h1>Authorization could not continue</h1><p class="warn">${escapeHtml(message)}</p>
<p class="muted">Return to your MCP client and start the connection again.</p></body></html>`;
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-frame-options': 'DENY',
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer',
    },
  });
}
