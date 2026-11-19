# Architecture and compatibility

## Components

```
MCP client (ChatGPT / Claude / Cursor …)
   │  OAuth 2.1 + PKCE
   ▼
┌──────────────────────────── Cloudflare Worker ────────────────────────────┐
│  @cloudflare/workers-oauth-provider                                       │
│    /.well-known/oauth-protected-resource/mcp   (RFC 9728)                 │
│    /.well-known/oauth-authorization-server     (RFC 8414)                 │
│    /oauth/register  /oauth/token  (DCR, code+PKCE, refresh, revoke)       │
│    /authorize  → our page: Access JWT or passphrase → consent → grant     │
│                                                                           │
│  /mcp → MCP SDK Streamable HTTP (stateless, JSON response)                │
│    tools → normalize → cache (KV) → gate (DO) → Xunji Open API            │
│                                                                           │
│  /healthz → booleans only                                                 │
└───────────────────────────────────────────────────────────────────────────┘
                                   │ HTTPS, bearer XUNJI_API_KEY (Worker secret)
                                   ▼
        trains.xunjiapp.cn  (train + movement catalog)
        api.xunjiapp.cn     (official plans)
```

## Data flow for one read

1. Client calls `tools/call` with a bearer token on `/mcp`.
2. Provider validates the token hash, audience and expiry, then passes
   `{ subject, label, scope }` as `ctx.props`.
3. Tool validates arguments (Zod), then calls `readDay`.
4. Cache hit (identity-scoped KV) returns immediately.
5. Cache miss: Durable Object `reserve(key, 15|30s)` returns `ready`, `wait`
   or `cooldown`. Waits are bounded; long waits become `deferred`.
6. Upstream call: 15s timeout, 2 MiB cap, gzip-aware, `{ res }` unwrapped.
7. Normalize (volume, duration, sets), cache, return compact JSON.

Write flow (disabled by default): tool → confirmation check → payload
validation → upstream upsert → replace the cached day with the server's
standardized response. `dry_run` is never sent.

## Compatibility matrix

| Surface | Supported | Notes |
|---|---|---|
| MCP Streamable HTTP | Yes | Stateless, JSON responses, `POST /mcp` only |
| MCP SSE (old transport) | No | Not implemented |
| OAuth 2.1 auth code + PKCE | Yes | S256 required for public clients |
| Client ID Metadata Documents | Yes | Preferred; provider validates and caches |
| Dynamic Client Registration | Yes | Kept for older clients |
| Pre-registered client | Via `OAuthHelpers.createClient()` | Not exposed as an endpoint |
| RFC 9728 protected resource metadata | Yes | Path-scoped document for `/mcp` |
| RFC 8414 authorization server metadata | Yes | Includes revocation, S256, `iss` |
| RFC 9207 `iss` | Yes | Present on success and error redirects |
| RFC 8707 `resource` | Yes | Validated on authorize and token |
| Refresh token rotation | Yes | `refreshTokenIdleTTL` 30 days |
| Token revocation | Yes | `/oauth/token` revocation per RFC 7009 |
| `offline_access` | Yes | Granted with consent |
| ChatGPT connectors | Implemented against the current OAuth contract | Live connection status is reported separately; do not assume until the operator's own connection is verified |
| Claude / Cursor / other MCP clients | Should work via CIMD or DCR | Not individually verified |

## Tool surface (v0.1)

| Tool | Mode | Bounds |
|---|---|---|
| `xunji_capabilities` | read | none |
| `xunji_get_training_day` | read | one day |
| `xunji_list_training_days` | read | ≤31 days, 2 uncached reads |
| `xunji_movement_history` | read | ≤62 days, 2 uncached reads |
| `xunji_training_stats` | read | ≤31 days, 2 uncached reads |
| `xunji_search_movements` | read | catalog cached 7 days |
| `xunji_list_plans` | read | none |
| `xunji_get_plan` | read | ≤92 days |
| `xunji_upsert_training_day` | write | opt-in only; ≤15 movements × 20 sets; ±6 months |

## Deliberate omissions

- **Nutrition and body data.** Their endpoints use different keys (`xjfood_`,
  `xjbody_`); the training key is rejected. They are not registered, not
  described as available, and not faked.
- **Template management and plan writes.** Read-only plan access is implemented;
  mutating schedules is out of scope.
- **Delete.** The vendor exposes no delete operation.
- **A web UI.** The bridge is an API; the only HTML is the consent page and a
  status page.
