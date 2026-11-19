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

## 3. Create the derived index (D1)

```bash
npx wrangler d1 create xunji-mcp-index
# copy the uuid into wrangler.jsonc d1_databases[0].database_id
npx wrangler d1 migrations apply xunji-mcp-index --remote
```

The index is disposable: deleting the D1 database only removes derived
aggregates and scan state; the next backfill rebuilds it.

## 4. Configure the worker

Edit `wrangler.jsonc`:

```jsonc
{
  "vars": {
    "PUBLIC_ORIGIN": "https://your-domain.example",
    "MCP_RESOURCE_PATH": "/mcp",
    "ALLOWED_USER_EMAILS": "you@example.com",
    "ENABLED_DATA_DOMAINS": "train",
    "WRITE_TOOLS_ENABLED": "false",
    "UPSTREAM_TIMEOUT_MS": "15000",
    "KV_WRITE_DAILY_BUDGET": "300",
    "SCAN_DAILY_LIMIT": "100",
  },
  "triggers": { "crons": ["10 16 * * *"] },
  "routes": [{ "pattern": "your-domain.example", "custom_domain": true }],
}
```

`PUBLIC_ORIGIN` is the OAuth issuer and the resource origin. It must match the
public URL exactly; OAuth clients compare it as a string.

## 5. Secrets

```bash
printf '%s' "$XUNJI_KEY_READ_FROM_YOUR_OWN_STORE" | npx wrangler secret put XUNJI_API_KEY
printf '%s' "$OWNER_PASSPHRASE" | npx wrangler secret put OWNER_PASSPHRASE
```

Never pass a key as a command-line argument; it lands in shell history and
process listings. Prefer piping from a file or an environment variable that is
already in scope.

Optional operator endpoint for backfill/status:

```bash
printf '%s' "$ADMIN_TOKEN" | npx wrangler secret put ADMIN_TOKEN
```

For Access mode instead of the passphrase:

```bash
npx wrangler secret put ACCESS_TEAM_DOMAIN   # team.cloudflareaccess.com
npx wrangler secret put ACCESS_AUD           # the Access application AUD tag
```

## 6. Protect `/authorize` with Cloudflare Access (recommended)

Create a self-hosted Access application for `<your-domain>/authorize` (and only
that path), with a policy allowing exactly the operator's email. Machine paths
must bypass Access:

| Path             | Access                                   |
| ---------------- | ---------------------------------------- |
| `/authorize`     | policy: one email                        |
| `/mcp`           | bypass (OAuth protects it)               |
| `/oauth/*`       | bypass (OAuth endpoints)                 |
| `/.well-known/*` | bypass (discovery)                       |
| `/healthz`       | bypass or protect; returns booleans only |
| `/admin/*`       | bypass; requires `ADMIN_TOKEN` Bearer    |

The Worker independently verifies the Access JWT signature, issuer, audience,
expiry and email allowlist. A path left unprotected therefore fails closed with
403 rather than granting access.

### Harden the operator gate

Two settings are easy to miss and both widen the gate:

**Disable the `workers.dev` route.** Access policies are attached to a hostname.
The default `https://<worker>.<account>.workers.dev` address bypasses the Access
application even when the custom domain is protected. Disable it in
**Workers & Pages → the Worker → Settings → Domains & Routes**, or set
`"workers_dev": false` in `wrangler.jsonc` and redeploy. Verify:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<worker>.<account>.workers.dev/healthz
# expected: 404 (or no route)
```

**Do not keep `OWNER_PASSPHRASE` when Access is configured.** It is a second
key that works from any entry point that reaches the Worker. With Access in
place, delete it:

```bash
npx wrangler secret delete OWNER_PASSPHRASE
```

Keep a copy in your password manager first: it is the documented emergency
fallback if Access itself breaks (see
[chatgpt-connect.md](chatgpt-connect.md#re-authenticating)). After deletion,
`/authorize` accepts only an Access identity; a direct request without an
Access JWT gets 403.

## 7. Deploy

```bash
npm run typecheck && npm test
npx wrangler deploy
```

## 8. Post-deploy checks

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

Then start the index backfill. Via MCP:

```json
{ "action": "backfill", "start": "2024-01-01" }
```

or via the operator endpoint:

```bash
curl -X POST https://your-domain.example/admin/backfill \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"start":"2024-01-01"}'
curl https://your-domain.example/admin/index -H "Authorization: Bearer $ADMIN_TOKEN"
```

The scanner processes at most `SCAN_DAILY_LIMIT` days per UTC day and continues
on the next day's first alarm. It writes D1 only — no KV writes during scans.

Set `MCP_UI_ENABLED=true` to expose the optional MCP Apps view described in
[tools.md](tools.md). The default is off; it adds one HTML resource but no data
access.

The cron trigger (`10 16 * * *`, 00:10 Asia/Shanghai) keeps the tail current:
it enqueues the gap between the latest complete/empty day and yesterday, then
starts the same scanner. It is a no-op until `history_start` exists. Today is
excluded so a partial day is not indexed; the next run covers it.

Then connect a client (see [chatgpt-connect.md](chatgpt-connect.md)) and call
`xunji_capabilities`, then `xunji_training_overview`.

## Rollback

`wrangler versions` lists deployments; `wrangler rollback [version-id]` restores
a previous one. Secrets are not versioned — rotating `XUNJI_API_KEY` takes
effect immediately and requires no redeploy.

If the bridge itself misbehaves, delete the Workers route/custom domain first;
the OAuth KV and cache can stay, since they contain no vendor key.

## Cost and quota

Free-plan sizing is plausible for one user, but the account-wide KV write quota
is the binding constraint (1,000 writes/day shared by every namespace):

- Historical days are never cached; only today/yesterday use KV.
- `KV_WRITE_DAILY_BUDGET` defaults to 300; over-budget writes are skipped and
  reported as `budgetDegraded` in tool meta.
- Backfill never writes KV; it writes D1 and respects `SCAN_DAILY_LIMIT`.
- `/admin/index` reports `kv.used`, `kv.budget`, `scanBudget.used` and
  `scanBudget.remaining`.
