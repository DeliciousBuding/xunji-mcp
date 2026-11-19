# xunji-mcp

A small, self-hosted **Model Context Protocol** bridge for [Xunji (训记)](https://xunjiapp.cn) training data. It runs on Cloudflare Workers, speaks OAuth 2.1, and exposes the operator's own training history to ChatGPT and other MCP clients as a handful of read-first tools.

It is deliberately **not** a fitness app, not a data warehouse, and not a multi-tenant service. Your Xunji key stays in the Worker; clients get an OAuth grant, never the key.

- [简体中文说明](README.zh-CN.md)
- [Architecture](docs/architecture.md) · [Threat model](docs/threat-model.md) · [Tools](docs/tools.md) · [Deploy](docs/deployment.md) · [ChatGPT setup](docs/chatgpt-connect.md)

## What it gives an agent

| Tool | Purpose |
|---|---|
| `xunji_capabilities` | What this deployment exposes, and its limits |
| `xunji_get_training_day` | One day: movements, sets, volume, duration, optional detail |
| `xunji_list_training_days` | Per-day rows for a range (≤31 days) |
| `xunji_movement_history` | One movement across days (≤62 days) |
| `xunji_training_stats` | Sessions, sets, volume, weekday split, top movements |
| `xunji_search_movements` | Canonical Chinese movement names from the public catalog |
| `xunji_list_plans` / `xunji_get_plan` | Official plan schedules, read-only |
| `xunji_upsert_training_day` | Opt-in write; **disabled by default** |

Results are compact JSON with stable fields, not raw vendor payloads. Missing training is a successful empty result. Every read reports upstream limits and cache status.

## Why the shape is unusual

Xunji paces reads **per account per calendar day**: 15 seconds for the light payload, 30 seconds for `include_full_data`. There is no range endpoint. The bridge therefore:

- caches normalized days per identity;
- serializes reads through a Durable Object that reserves vendor slots;
- returns a typed `deferred` result with `retryAfterSeconds` instead of hanging;
- caps range tools at two uncached reads per call and reports `pending` dates.

Writes are deliberately conservative. Verified on 2026-11-19: the vendor's training upsert **ignores `dry_run`**, so a "preview" is a real write. This project never sends that flag, requires `confirmed: true`, refuses dates outside six months, and cannot delete anything (the vendor has no delete API).

Nutrition and body-data endpoints use separate vendor keys; this bridge does not expose them and does not pretend to.

## Quick start (local)

```bash
npm install
cp wrangler.example.jsonc wrangler.jsonc   # edit origin + KV ids
npx wrangler kv namespace create OAUTH_KV
npx wrangler kv namespace create CACHE_KV
printf 'owner-passphrase' | npx wrangler secret put OWNER_PASSPHRASE
printf 'your-xunji-key'   | npx wrangler secret put XUNJI_API_KEY
npm run typecheck && npm test
npm run dev
```

`wrangler dev` serves `http://localhost:8787/mcp`; the OAuth metadata uses `PUBLIC_ORIGIN`, so set it to `http://localhost:8787` for local client testing.

## Security posture

- OAuth 2.1 authorization code + PKCE S256, exact redirect matching, `resource` audience, `iss`, refresh rotation and revocation, via [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider).
- Authorization requires the operator: a Cloudflare Access JWT verified against the team JWKS plus an email allowlist, or a deployment passphrase. No identity, no grant; no "allow all" switch.
- Single-operator by design. Cache keys are identity-scoped.
- No raw payloads, keys or tokens in logs. `/healthz` returns booleans only.
- Read-only default. Writes require `WRITE_TOOLS_ENABLED=true`, the `xunji:write` scope and explicit user confirmation.

Read [SECURITY.md](SECURITY.md) and [docs/threat-model.md](docs/threat-model.md) before deploying publicly.

## Status

The protocol and upstream behavior are covered by unit, contract and workerd integration tests (34 at v0.1.0). On 2026-11-19 a private deployment completed the full path: OAuth through Cloudflare Access, a ChatGPT connector connection, and a live `tools/call` returning the expected session and movement counts. That verification is deployment-specific; see [docs/acceptance.md](docs/acceptance.md) for each criterion and how to repeat it.

## License

MIT. Xunji and 训记 are trademarks of their respective owners; this project is unaffiliated.
