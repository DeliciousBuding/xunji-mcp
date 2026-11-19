# Deployment

Target: one Cloudflare Worker, one custom domain, one Xunji account.

## 1. Prerequisites

- Node 20+ and Wrangler 4.
- A Cloudflare zone you control.
- A Xunji Open API key from the Xunji app (training-data skill).
- Optional but recommended: a Cloudflare Access application for `/authorize`.

## 2. Create the two KV namespaces

```bash
npx wrangler kv namespace create OAUTH_KV
npx wrangler kv namespace create CACHE_KV
```

Copy the printed ids into your private `wrangler.jsonc` (copied from
`wrangler.example.jsonc` and gitignored).

## 3. Configure the worker

Edit `wrangler.jsonc`:

```jsonc
{
  "vars": {
    "PUBLIC_ORIGIN": "https://your-domain.example",
    "MCP_RESOURCE_PATH": "/mcp",
    "ALLOWED_USER_EMAILS": "you@example.com",
    "ENABLED_DATA_DOMAINS": "train",
    "WRITE_TOOLS_ENABLED": "false",
    "UPSTREAM_TIMEOUT_MS": "15000"
  },
  "routes": [{ "pattern": "your-domain.example", "custom_domain": true }]
}
```

`PUBLIC_ORIGIN` is the OAuth issuer and the resource origin. It must match the
public URL exactly; OAuth clients compare it as a string.

## 4. Secrets

```bash
printf '%s' "$XUNJI_KEY_READ_FROM_YOUR_OWN_STORE" | npx wrangler secret put XUNJI_API_KEY
printf '%s' "$OWNER_PASSPHRASE" | npx wrangler secret put OWNER_PASSPHRASE
```

Never pass a key as a command-line argument; it lands in shell history and
process listings. Prefer piping from a file or an environment variable that is
already in scope.

For Access mode instead of the passphrase:

```bash
npx wrangler secret put ACCESS_TEAM_DOMAIN   # team.cloudflareaccess.com
npx wrangler secret put ACCESS_AUD           # the Access application AUD tag
```

## 5. Protect `/authorize` with Cloudflare Access (recommended)

Create a self-hosted Access application for `<your-domain>/authorize` (and only
that path), with a policy allowing exactly the operator's email. Machine paths
must bypass Access:

| Path | Access |
|---|---|
| `/authorize` | policy: one email |
| `/mcp` | bypass (OAuth protects it) |
| `/oauth/*` | bypass (OAuth endpoints) |
| `/.well-known/*` | bypass (discovery) |
| `/healthz` | bypass or protect; returns booleans only |

The Worker independently verifies the Access JWT signature, issuer, audience,
expiry and email allowlist. A path left unprotected therefore fails closed with
403 rather than granting access.

## 6. Deploy

```bash
npm run typecheck && npm test
npx wrangler deploy
```

## 7. Post-deploy checks

```bash
curl -s https://your-domain.example/healthz
curl -si https://your-domain.example/.well-known/oauth-protected-resource/mcp
curl -si -X POST https://your-domain.example/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Expected: health reports `upstreamKey: true` and `operatorGate: true`; metadata
names the canonical resource; `/mcp` returns 401 with a `WWW-Authenticate`
challenge that includes `resource_metadata` and `scope="xunji:read"`.

Then connect a client (see [chatgpt-connect.md](chatgpt-connect.md)) and call
`xunji_capabilities`, then `xunji_get_training_day` for a date you know.

## Rollback

`wrangler versions` lists deployments; `wrangler rollback [version-id]` restores
a previous one. Secrets are not versioned — rotating `XUNJI_API_KEY` takes
effect immediately and requires no redeploy.

If the bridge itself misbehaves, delete the Workers route/custom domain first;
the OAuth KV and cache can stay, since they contain no vendor key.

## Cost

Free-plan sizing is plausible for one user: a handful of requests per day, two
KV namespaces and one Durable Object class. Cache writes dominate; adjust
`cacheTtlSeconds` in `src/cache.ts` if KV writes matter more than freshness.
