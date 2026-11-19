# Architecture and compatibility

[English](architecture.md) · [简体中文](architecture.zh-CN.md)

xunji-mcp runs as one Cloudflare Worker serving one operator's Xunji account.
Xunji remains the source of truth. D1 holds a rebuildable analytics index;
KV holds OAuth state and a small read cache. Deployment identities and keys
belong in private configuration and Worker secrets.

## Components

```text
MCP client
  ├─ OAuth discovery / registration / token exchange
  │    └─ @cloudflare/workers-oauth-provider
  │         └─ /authorize: Access identity or passphrase, then consent
  └─ POST /mcp: MCP SDK Streamable HTTP, stateless JSON responses
       ├─ indexed queries → D1
       ├─ day reads → hot KV cache → UpstreamGate → Xunji training API
       ├─ history controls → D1 scan_day → ScanCoordinator alarms
       │                                      └─ UpstreamGate → Xunji
       ├─ catalog / plans → Xunji
       └─ optional body / nutrition adapters → separate Xunji keys

Scheduled trigger → enqueue uncovered tail → ScanCoordinator
/healthz          → version, identity mode, configuration flags and count
/admin/*          → ADMIN_TOKEN-protected index controls and tool inventory
Optional MCP Apps resource: ui://xunji/overview
```

| State             | Contents                                                                         | Isolation and lifetime                                       |
| ----------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `OAUTH_KV`        | Provider-managed clients, grants and tokens                                      | OAuth lifetimes; upstream keys are excluded                  |
| `CACHE_KV`        | Unwrapped training responses for today/yesterday and the public movement catalog | Day entries include a subject hash and payload mode          |
| D1 `DB`           | `session`, `movement`, `set_fact`, `scan_day`, metadata and budget counters      | One account per database; no subject column                  |
| `UpstreamGate`    | Reservation and cooldown timestamps                                              | Keyed by subject hash, date and light/full mode              |
| `ScanCoordinator` | Scan subject, mode, progress and alarm                                           | One deployment-wide coordinator; queue and pause state in D1 |

D1 and the scan coordinator are optional bindings. Without D1, bounded
on-demand reads still work, but the D1-backed cache-write budget cannot be
used, so new KV cache entries are skipped.

## One-day read flow

1. The OAuth provider validates the bearer token and its resource binding.
   The Worker obtains `{ subject, label, scope }` from `ctx.props`.
2. The tool validates arguments with Zod and calls `readDay`.
3. Unless `refresh: true` was requested, a valid hot KV entry returns first.
4. A cache miss reserves a slot in `UpstreamGate`: 15 seconds for light
   reads, 30 seconds for full reads. A bounded wait or a stored cooldown can
   produce `deferred` with `retryAfterSeconds`.
5. The upstream client sends a JSON POST, handles gzip, unwraps `{ res }`,
   and maps failures to stable codes.
6. Eligible responses are cached before normalization. The tool normalizes
   the response and returns training data plus metadata.

Today is evaluated in `Asia/Shanghai`. Today has a five-minute cache TTL;
yesterday has a two-minute TTL. Other dates are not written to the day cache.
The catalog has a seven-day TTL. KV cache writes share a D1 counter with a
default budget of 300 attempts per UTC day; skipped or failed writes do not
turn a successful upstream read into an error.

On-demand day reads do not query or update D1. Repeating the same historical
range does not advance a cursor: follow the returned `pending` dates with a
narrower request, or use the indexed tools.

## Indexed query flow

1. Tool arguments select bounded filters, metrics and grouping enums.
2. The query layer resolves the window and builds SQL from fixed expressions
   with bound filter values. Clients cannot supply SQL.
3. SQLite aggregates completed `set_fact` rows and obtains session durations
   separately.
4. The result carries `columns`, `rows`, `totals`, units, metric definitions
   and coverage from `scan_day`.
5. Analytic tools return a short text summary and keep the data in
   `structuredContent`. Legacy day tools serialize the same JSON in both
   result fields.

`all_time` uses the stored `history_start`, then the earliest terminal scan
date, then a fallback window. It describes the indexed window, not a discovered
start of the account's history. Read the [coverage guide](coverage.md) before
interpreting empty or partial results.

## Backfill and refresh

`xunji_history` enqueues dates and starts an alarm; the upstream reads happen
outside the tool call. Each alarm processes up to nine due dates, at concurrency
three, within a 20-second loop budget. It reads light payloads with KV reads
and writes disabled. Successful reads replace indexed facts; deferred reads
and errors persist a retry time. Pause state and the queue survive requests
and restarts.

The default scan budget is 100 attempted dates per UTC day. When exhausted,
the coordinator schedules the next alarm shortly after UTC midnight.
These limits bound work; they do not promise an upstream completion time.

Replacement clears the old day's facts and inserts new facts in batches of
80 statements, then records `complete` or `empty`. The whole day and scan
status are not one transaction. Coverage must be checked during refresh or
after a failed batch.

The example cron, `10 16 * * *` (00:10 `Asia/Shanghai`), enqueues the tail
after the latest `complete`/`empty` date through yesterday. It needs a history
start. It does not revisit earlier edits or gaps; use `refresh` for those.
Automatic scans exclude today; manual history requests can choose their own
end date.

## Writes

The write tool is absent by default. Registration requires the `train` domain,
`xunji:read`, `WRITE_TOOLS_ENABLED=true` and `xunji:write`. A call must also
provide `confirmed: true`; its upstream key must be configured.

An upsert creates or updates one session. A returned nonempty training payload
may replace the eligible light day-cache entry. It does not update D1 or
invalidate the full-mode cache. Refresh the index separately after a change.
Every call is a real write: `dry_run` is never sent, and there is no delete
tool.

## Compatibility

| Surface                             | Implementation                                                                             | Verification boundary                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| MCP Streamable HTTP                 | Stateless JSON responses; `POST /mcp` only; 32 KiB request-body limit                      | No legacy SSE endpoint or persistent MCP session                 |
| OAuth authorization code + PKCE     | Provider-managed; S256 required for public clients                                         | The bridge owns operator identity and consent                    |
| Client ID Metadata Documents (CIMD) | Enabled; provider validates client metadata                                                | Requires `global_fetch_strictly_public`                          |
| Dynamic Client Registration (DCR)   | `/oauth/register`                                                                          | Registration grants no data access                               |
| Pre-registered clients              | Provider `createClient()` helper                                                           | No application endpoint for this helper                          |
| RFC 9728 resource metadata          | `/.well-known/oauth-protected-resource/mcp` for the default path                           | Canonical resource is `PUBLIC_ORIGIN + MCP_RESOURCE_PATH`        |
| RFC 8414 / RFC 9207 / RFC 8707      | Authorization metadata, `iss` on provider redirects, resource binding                      | Invalid authorization requests can be rendered locally           |
| Token refresh and revocation        | Rotation; one-hour access tokens; 30-day refresh idle lifetime; RFC 7009 at `/oauth/token` | Provided by the OAuth library                                    |
| `offline_access`                    | Advertised in provider metadata                                                            | The current authorization page filters it out of grants          |
| ChatGPT and other MCP clients       | Standards-based connection path                                                            | Repeat OAuth, tool discovery and a read in each client/workspace |
| MCP Apps overview                   | Optional HTML resource linked to the overview tool                                         | Host rendering is a separate check from tool execution           |

## Optional domains and presentation

Body, nutrition and food-search adapters exist, but register only with their
matching independent keys and enabled domain. Their live response contracts
remain unverified. Training keys do not unlock these domains.

With D1, the `train` domain, read scope and `MCP_UI_ENABLED=true`, the server
registers `ui://xunji/overview` as `text/html;profile=mcp-app`. Its current
labels are Simplified Chinese. It renders overview KPIs and monthly volume
from the existing structured result using host messages. It performs no
network requests, persists no data and calls no tools. Unsupported hosts can
continue using the text and structured result.

Template management, plan writes, plan-versus-recorded-day comparison and
upstream deletion are outside the implemented surface. See
[tools](tools.md), [upstream contracts](api-contract.md), the
[threat model](threat-model.md) and [deployment guide](deployment.md).
