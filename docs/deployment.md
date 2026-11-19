# Deployment

[English](deployment.md) · [简体中文](deployment.zh-CN.md)

Target: one Cloudflare Worker, one custom domain, one Xunji account.
All hostnames, emails and resource IDs below are public placeholders.
Run deployment commands only against infrastructure you control.

## 1. Prerequisites

- Node 20+ and Wrangler 4.
- A Cloudflare zone you control.
- A Xunji Open API key from the Xunji app (training-data skill).
- Optional but recommended: a Cloudflare Access application for `/authorize`.

Install the repository dependencies and create the private configuration:

```bash
npm ci
cp wrangler.example.jsonc wrangler.jsonc
```

Keep `wrangler.jsonc` out of Git. Preserve the example's KV, D1, Durable Object
bindings and migration declarations when editing deployment values.

## 2. Create the two KV namespaces

```bash
npx wrangler kv namespace create OAUTH_KV
npx wrangler kv namespace create CACHE_KV
```

Copy the returned namespace IDs into the private `wrangler.jsonc`.
Do not publish them as a verification result.

## 3. Create the derived index (D1)

```bash
npx wrangler d1 create xunji-mcp-index
# copy the returned ID into wrangler.jsonc d1_databases[0].database_id
npx wrangler d1 migrations apply xunji-mcp-index --remote
```

The example binds D1 as `DB`, `UpstreamGate` as `UPSTREAM_GATE`, and
`ScanCoordinator` as `SCAN_COORDINATOR`. It declares SQLite Durable Object
migrations `v1`/`v2` and D1 migrations under `migrations/`; deploy with those
bindings intact.

D1 stores derived facts, scan state and cache/scan budget counters. It can be
rebuilt by a backfill without changing Xunji. Removing it also removes those
local controls and the cache-write counter. D1 is optional for bounded day
reads, but required for indexed analysis and cache puts; the scanner binding
is additionally required for history controls.

## 4. Configure the worker

Merge these settings into `wrangler.jsonc`; this fragment does not replace the
bindings and migrations in the example:

```jsonc
{
  "vars": {
    "PUBLIC_ORIGIN": "https://exercise.example.com",
    "MCP_RESOURCE_PATH": "/mcp",
    "ALLOWED_USER_EMAILS": "you@example.com",
    "ENABLED_DATA_DOMAINS": "train",
    "WRITE_TOOLS_ENABLED": "false",
    "UPSTREAM_TIMEOUT_MS": "15000",
    "KV_WRITE_DAILY_BUDGET": "300",
    "SCAN_DAILY_LIMIT": "100",
    "MCP_UI_ENABLED": "false",
  },
  "workers_dev": false,
  "triggers": { "crons": ["10 16 * * *"] },
  "routes": [{ "pattern": "exercise.example.com", "custom_domain": true }],
}
```

`PUBLIC_ORIGIN` is the OAuth issuer and the resource origin. It must match the
public URL exactly; OAuth clients compare it as a string. Use the canonical
HTTPS origin without a trailing slash. The example enables
`global_fetch_strictly_public`, required for provider-managed CIMD fetching.

`ENABLED_DATA_DOMAINS` defaults to `train`. Body/nutrition tools need both an
enabled domain and the matching independent secret. Their adapters are not
live-verified; do not treat adding a key as verification.

## 5. Secrets

```bash
printf '%s' "$XUNJI_KEY_READ_FROM_YOUR_OWN_STORE" | npx wrangler secret put XUNJI_API_KEY
```

Never pass a key as a command-line argument; it lands in shell history and
process listings. Prefer piping from a file or an environment variable that is
already in scope.

Choose the operator gate in the next section. For a deployment without Access,
use a high-entropy passphrase:

```bash
printf '%s' "$OWNER_PASSPHRASE" | npx wrangler secret put OWNER_PASSPHRASE
```

Optional operator endpoints for backfill, index status and tool inventory:

```bash
printf '%s' "$ADMIN_TOKEN" | npx wrangler secret put ADMIN_TOKEN
```

For Access mode instead of the passphrase:

```bash
npx wrangler secret put ACCESS_TEAM_DOMAIN   # team.cloudflareaccess.com
npx wrangler secret put ACCESS_AUD           # the Access application AUD tag
```

`ALLOWED_USER_EMAILS` is a comma-separated private allowlist. Access mode
requires a matching entry; an empty allowlist cannot authorize anyone.
Passphrase mode uses the first allowlist entry for its label/subject if present,
otherwise a fallback operator identity.

Optional independent keys are `XUNJI_BODY_KEY`, `XUNJI_FOOD_KEY` and
`XUNJI_FOOD_SEARCH_KEY`. If configuring one, use `wrangler secret put`, verify
its read contract privately, and enable `body` or `nutrition` deliberately.
Keep all domain keys tied to the deployment's one operator account.

## 6. Protect `/authorize` with Cloudflare Access (recommended)

Create a self-hosted Access application for `<your-domain>/authorize` (and only
that path), with a policy allowing exactly the operator's email. Machine paths
must bypass Access:

| Path             | Access                                         |
| ---------------- | ---------------------------------------------- |
| `/authorize`     | policy: one email                              |
| `/mcp`           | bypass (OAuth protects it)                     |
| `/oauth/*`       | bypass (OAuth endpoints)                       |
| `/.well-known/*` | bypass (discovery)                             |
| `/healthz`       | bypass or protect; configuration metadata only |
| `/admin/*`       | bypass; requires `ADMIN_TOKEN` Bearer          |

The Worker independently verifies the Access JWT signature, issuer, audience,
expiry and email allowlist. In Access-only mode, a request without a valid,
allowlisted JWT fails with 403. If a passphrase is also configured, it remains
an alternate authorization path.

### Harden the operator gate

Two settings are easy to miss and both widen the gate:

**Disable the `workers.dev` route.** Access policies are attached to a hostname.
The default `https://<worker>.<account>.workers.dev` address bypasses the Access
application even when the custom domain is protected. Disable it in
**Workers & Pages → the Worker → Settings → Domains & Routes**, or set
`"workers_dev": false` in `wrangler.jsonc` and redeploy. Check that the alternate
hostname has no active route; a deployment-specific probe can use:

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

A temporary passphrase can be restored from a password manager if Access
breaks (see
[chatgpt-connect.md](chatgpt-connect.md#re-authenticating)). After deletion,
`/authorize` accepts only an Access identity; a direct request without an
Access JWT gets 403.

## 7. Deploy

```bash
npm run typecheck && npm test
```

Before publishing, also run the repository's required lint/format and secret
checks:

```bash
npm run lint
npm run format:check
node scripts/secret-scan.mjs --history
npx wrangler deploy
```

These checks use the repository's synthetic/stubbed verification path.
They do not establish client compatibility or live index completeness.

## 8. Post-deploy checks

```bash
curl -s https://exercise.example.com/healthz
curl -si https://exercise.example.com/.well-known/oauth-protected-resource/mcp
curl -si https://exercise.example.com/.well-known/oauth-authorization-server
curl -si -X POST https://exercise.example.com/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Expected: health's `configured` block reports `upstreamKey: true` and
`operatorGate: true`, plus index/scanner flags when bound. The response also
includes version, identity mode, allowlist count and UI/write flags. Metadata
names the canonical resource; `/mcp` returns 401 with a `WWW-Authenticate`
challenge that includes `resource_metadata` and `scope="xunji:read"`.

Health reports presence, not key validity or completed migrations. Connect
through OAuth and inspect `tools/list` before relying on capability rows.
An optional `GET /admin/tools` with `ADMIN_TOKEN` reports a read-only tool and
resource inventory; it performs no upstream read.

Then choose the history bounds and start the index backfill. The following
MCP request uses a date placeholder; replace it with the operator's intended
history start:

```json
{ "action": "backfill", "start": "YYYY-MM-DD" }
```

Or use the operator endpoint with `HISTORY_START_DATE` supplied from private
configuration:

```bash
printf '{"start":"%s"}' "$HISTORY_START_DATE" | \
  curl -X POST https://exercise.example.com/admin/backfill \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  --data-binary @-
curl https://exercise.example.com/admin/index -H "Authorization: Bearer $ADMIN_TOKEN"
```

The scanner uses at most `SCAN_DAILY_LIMIT` attempted dates per UTC day under
its normal single-coordinator loop and resumes shortly after the next UTC
midnight when the budget is exhausted. It skips KV reads/writes and persists
facts/queue state in D1. Acceptance of a backfill is not completion; inspect
the coverage of the requested window.

Set `MCP_UI_ENABLED=true` to expose the optional MCP Apps view described in
[tools.md](tools.md). The default is off. The view needs D1 and training read
scope, displays the existing structured result, and adds no network access or
storage. Confirm rendering separately in the selected host.

The cron trigger (`10 16 * * *`, 00:10 `Asia/Shanghai`) keeps the tail current:
it enqueues the gap between the latest complete/empty day and yesterday, then
starts the same scanner. It is a no-op without a stored history start or
`HISTORY_START_DATE`. Automatic scans exclude today. The cron does not refresh
older edited dates or gaps before the latest terminal scan; use
`xunji_history action=refresh` for those. Day replacement spans batches, so
coverage must be inspected after failures.

Then connect a client (see [chatgpt-connect.md](chatgpt-connect.md)) and call
`xunji_capabilities`, then `xunji_training_overview`.
Keep real read values and deployment-specific results in a private operator
record; publish only generic verification methods and unresolved capabilities.

## Enabling writes

Keep `WRITE_TOOLS_ENABLED=false` for the default read-first deployment.
Enabling it only permits registration when the OAuth token also has read and
write scopes and training is enabled. An existing read-only grant needs
reauthorization for write scope. Each call requires `confirmed: true`.

Every upsert is a real upstream write. There is no `dry_run` or delete path.
Confirm the exact session change before calling, read back the result, and
refresh D1 separately. The upsert path does not update the index or invalidate
full-mode cache entries. Disabling the flag removes the write tool even from
tokens that already carry write scope.

## Rollback

Use `wrangler versions` to inspect version history and
`wrangler rollback [version-id]` to restore a previous Worker version.
Check Wrangler's output and the active version after a configuration or secret
change; do not infer activation from a local edit.

A Worker rollback does not undo upstream writes, D1 scan changes or OAuth KV
changes. Review bindings and schema compatibility before reverting code.

If the bridge itself misbehaves, delete the Workers route/custom domain first;
the OAuth KV and cache can stay while diagnosing, but still contain sensitive
grants and training data. Rotate a suspected exposed Xunji key in the Xunji app
and revoke affected OAuth grants through the provider's supported helpers.

## Cost and quota

Size the deployment against the current Cloudflare account limits. The code
supplies cache and scan budgets; it does not cap the account's total bill:

- Historical days are never cached; only today/yesterday use KV.
- `KV_WRITE_DAILY_BUDGET` defaults to 300 cache-put attempts per UTC day.
  Over-budget, missing-D1 or failed writes are skipped. Current day tools do not
  forward the cache-layer degradation flag to tool metadata.
- Backfill never writes KV; it writes D1 and respects `SCAN_DAILY_LIMIT`.
- Provider-owned `OAUTH_KV` writes are outside the cache budget.
- `/admin/index` reports `kv.used`, `kv.budget`, `scanBudget.used` and
  `scanBudget.remaining`; `kv.used` is the attempt counter, not a confirmed
  account-wide write total.

See [coverage](coverage.md) and [the threat model](threat-model.md) for the
limits of these checks and controls.
