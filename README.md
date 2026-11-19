# xunji-mcp

[![CI](https://github.com/DeliciousBuding/xunji-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/DeliciousBuding/xunji-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)
[![MCP](https://img.shields.io/badge/MCP-streamable%20HTTP-blue.svg)](https://modelcontextprotocol.io)

A small, self-hosted **Model Context Protocol** bridge for [Xunji (训记)](https://xunjiapp.cn) training data, running on Cloudflare Workers with OAuth 2.1 and a derived analytics index.

It is deliberately **not** a fitness app, not a second source of truth, and not a multi-tenant service. Your Xunji key stays in the Worker; clients get an OAuth grant, never the key. Xunji remains authoritative; the index is disposable and rebuildable.

- [简体中文](README.zh-CN.md) · [Architecture](docs/architecture.md) · [Tools](docs/tools.md) · [Coverage matrix](docs/coverage.md) · [Benchmark](docs/benchmark.md) · [Deploy](docs/deployment.md) · [ChatGPT](docs/chatgpt-connect.md)
- Optional `MCP_UI_ENABLED=true` adds one sandboxed MCP Apps view (KPI tiles + monthly volume) for the overview tool; text output stays the fallback.
- Optional `MCP_UI_ENABLED=true` adds one sandboxed MCP Apps view (KPI tiles + monthly volume) for the overview tool; text output stays the fallback.

## What it gives an agent

The 0.2 layer answers analysis tasks in one call instead of wrapping endpoints:

| Tool                                                                           | Purpose                                                                    |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `xunji_capabilities`                                                           | Live endpoint/tool/scope/configured/verified matrix and index coverage     |
| `xunji_training_overview`                                                      | All-history KPIs: sessions, sets, volume, duration, trend, top movements   |
| `xunji_query_training`                                                         | Declarative query: range × movement/muscle × day/week/month/year × metrics |
| `xunji_movement_progress`                                                      | Best set, Epley e1RM, PR timeline, monthly volume, plateau heuristic       |
| `xunji_history`                                                                | Index coverage and resumable background backfill/refresh                   |
| `xunji_get_training_day`                                                       | One-day drill-down with optional full detail                               |
| `xunji_search_movements`                                                       | Canonical Chinese movement names                                           |
| `xunji_list_plans` / `xunji_get_plan`                                          | Official plans, read-only                                                  |
| `xunji_list_training_days` / `xunji_training_stats` / `xunji_movement_history` | Legacy bounded tools, kept for 0.1 clients                                 |
| `xunji_upsert_training_day`                                                    | Opt-in write; not registered unless **`WRITE_TOOLS_ENABLED=true`**         |

Query results use columnar `columns`/`rows`, explicit units and metric definitions, coverage/freshness, and a short text summary; they do not duplicate a large JSON payload in both MCP fields. An empty day and an unscanned day are different states.

## Why the shape is unusual

Xunji paces reads **per account per calendar day** (15 s light / 30 s full) and exposes no range or bulk endpoint. Covering years day-by-day from an MCP client would mean hundreds of round trips, so the bridge:

1. keeps a **derived D1 index** (`session`, `movement`, `set_fact`, `scan_day`);
2. backfills it in a **Durable Object alarm loop**, resumable and idempotent;
3. computes totals and time buckets **in SQLite**, not in the model context;
4. reports `coverage` separately: unscanned days are never silently treated as zero;
5. keeps all-history overview at **one tool call** and a few hundred tokens;
6. scans at most **100 days per UTC day** and never writes KV during a scan.

Cloudflare's free KV allowance is shared by every Worker on the account and is
write-bound (1,000/day). The hot-key cache therefore has a **300 writes/day**
budget and only stores today/yesterday; historical reads use D1. A scan writes
D1 only.

Measured against the 0.1 per-day shape on synthetic history:

| History | 0.1 calls |     0.1 output | 0.2 calls |  0.2 output |
| ------- | --------: | -------------: | --------: | ----------: |
| 1 year  |       183 |  ~43.8k tokens |         1 | ~552 tokens |
| 3 years |       548 | ~131.4k tokens |         1 | ~555 tokens |

See [docs/benchmark.md](docs/benchmark.md) for methodology and caveats.

Writes are deliberately conservative: the vendor's training upsert **ignores `dry_run`** (verified 2026-11-19), so a preview is a real write. This project never sends that flag, requires `confirmed: true`, refuses dates outside six months, and cannot delete (no vendor delete API).

## Quick start

```bash
npm install
cp wrangler.example.jsonc wrangler.jsonc   # edit origin + resource ids
npx wrangler types
npx wrangler kv namespace create OAUTH_KV
npx wrangler kv namespace create CACHE_KV
npx wrangler d1 create xunji-mcp-index
npx wrangler d1 migrations apply xunji-mcp-index --remote
printf 'owner-passphrase' | npx wrangler secret put OWNER_PASSPHRASE
printf 'your-xunji-key'   | npx wrangler secret put XUNJI_API_KEY
npm run check
npm run dev
```

Then connect a client and call `xunji_history` with `action=backfill`, for example
`{"action":"backfill","start":"2024-01-01"}`. The scan continues in the
background; poll `action=status`. `start` defines the window you are willing to
claim as covered — earlier days are never implied.

`npm run bench` reproduces the synthetic benchmark.

## Coverage and boundaries

- **Training**: day reads, indexed queries, PR/e1RM, official plans, movement catalog.
- **Body and nutrition**: adapters exist from the official skills but require
  separate Xunji keys. They are not registered without them and are marked
  unverified until observed live.
- **Templates and writes**: out of scope by default. Write tools require explicit
  enablement and remain mock-tested only.
- **No delete**: the vendor exposes none; the bridge does not claim otherwise.
- **Single operator**: cache and index are keyed to one deployment owner.

`xunji_capabilities` is the machine-readable truth; [docs/coverage.md](docs/coverage.md)
is the readable table.

## Security posture

- OAuth 2.1 authorization code + PKCE S256, exact redirect matching, `resource`
  audience, `iss`, refresh rotation and revocation via
  [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider).
- Authorization requires the operator: Cloudflare Access JWT verified against the
  team JWKS plus an email allowlist, or a deployment passphrase. No identity, no
  grant; no "allow all" switch.
- Identity-scoped cache and index; no raw payloads, keys or tokens in logs.
- `/healthz` returns booleans only; `/admin/*` is a separate operator token and
  returns counts only.
- Read-only default. Writes require `WRITE_TOOLS_ENABLED=true`, the `xunji:write`
  scope and explicit user confirmation.

Read [SECURITY.md](SECURITY.md) and [docs/threat-model.md](docs/threat-model.md)
before exposing an instance.

## Status

57 unit, contract and workerd integration tests; CI covers typecheck, ESLint,
Prettier, tests, secret scan and a runtime-only dependency audit. On 2026-11-19 a
private deployment completed OAuth through Cloudflare Access, a ChatGPT
connector connection, and live read calls; the 0.2 index was backfilled and
queried through the deployment endpoint. Compatibility is still verified per
deployment — see [docs/acceptance.md](docs/acceptance.md).

## License

MIT. Xunji and 训记 are trademarks of their respective owners; this project is
unaffiliated.
