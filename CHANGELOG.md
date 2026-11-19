# Changelog

[English](CHANGELOG.md) · [简体中文](CHANGELOG.zh-CN.md) · [Release notes](docs/releases/README.md)

## 0.3.1 — 2026-11-19

### Added

- Bilingual GitHub Pages project site, with separate English and Chinese URLs,
  synthetic interactive examples, accessible controls, and local assets.
- Matching Chinese documentation for architecture, upstream contracts, tools,
  deployment, client connection, privacy, security, contribution, and acceptance.
- Bilingual historical release notes and a shared documentation index.
- Centered rounded-icon cover, local Manrope/Noto Sans SC fonts, editable
  HTML/CSS, and browser-rendered 2560×1280 README and 1280×640 sharing PNGs.
- Project icon, README branding, and MCP `icons` metadata added after the v0.3.0 tag.

### Changed

- README presents questions, supported scope, setup, and validation with
  consistent navigation between languages.
- Privacy and support guides reflect D1, short-lived KV cache, Durable Object
  state, and the optional body/nutrition adapters.
- Public acceptance documentation omits personal training statistics and private
  deployment identifiers.

### Fixed

- `xunji_capabilities` reports the shared server version instead of a stale
  hardcoded v0.2.0 value.
- The consent page explains persistent analytics-index storage alongside the
  OAuth state and read cache.

## 0.3.0 — 2026-11-19

### Added

- Optional MCP Apps view for `xunji_training_overview`
  (`ui://xunji/overview`, `text/html;profile=mcp-app`): KPI tiles, a monthly
  volume chart, coverage badge and host theme support. One self-contained HTML
  document, no external requests, no extra data access; text output remains the
  fallback.
- The tool advertises `_meta.ui.resourceUri` and the ChatGPT Apps SDK
  `openai/outputTemplate` when `MCP_UI_ENABLED=true`; the default is off.

## 0.2.1 — 2026-11-19

### Added

- A daily cron (`10 16 * * *`, 00:10 Asia/Shanghai) enqueues only the gap
  between the latest complete/empty day and yesterday, then starts the existing
  scanner. The index tail stays current without client traffic; today is
  indexed the next day.

### Changed

- `workers_dev` defaults to `false` in the example config, so the Access gate
  cannot be bypassed through the account's `workers.dev` hostname.
- The deployment, ChatGPT, threat-model and security docs describe the hardened
  operator gate and how to re-authenticate after revoking a connector.

## 0.2.0 — 2026-11-19

### Added

- Derived D1 index for multi-year history and SQL aggregation.
- `xunji_query_training`, `xunji_training_overview`,
  `xunji_movement_progress`, `xunji_history`.
- Resumable background backfill in a Durable Object alarm loop, with coverage,
  retry backoff, source-edit/delete replacement and pause/resume.
- Optional body and food adapters, registered only when their separate vendor
  keys are configured.
- Coverage matrix surfaced by `xunji_capabilities` (`configured`/`verified`).
- Synthetic 1-year/3-year benchmark and quota guardrails.

### Changed

- Calendar dates are evaluated in `Asia/Shanghai`, not UTC.
- Legacy bounded tools remain for 0.1 clients; new integrations use the query
  tools.
- Query tools return compact columnar data in `structuredContent` and a short
  summary in text, instead of duplicating JSON.

### Fixed

- Historical reads no longer write KV; only today/yesterday use a hot-key cache.
- Scan path performs zero KV writes and respects a 100-day/day scan budget.
- KV writes are capped at 300/day for this deployment, leaving room for other
  Workers on the account.
- Official plan default window follows the vendor contract (-7d to +30d).

## 0.1.0 — 2026-11-19

Initial release.

- MCP Streamable HTTP endpoint on Cloudflare Workers.
- OAuth 2.1 via `@cloudflare/workers-oauth-provider`: CIMD and DCR, PKCE S256,
  RFC 9728 protected-resource metadata, RFC 8414 authorization-server metadata,
  RFC 9207 `iss`, resource audience, refresh rotation and revocation.
- Operator gate: Cloudflare Access JWT verification with an email allowlist, or
  a deployment passphrase; fail-closed when neither is configured.
- Read tools: capabilities, day, range, movement history, stats, movement
  catalog, official plans.
- Opt-in write tool, disabled by default; never sends `dry_run`.
- Identity-scoped cache and a per-day Durable Object that respects the vendor's
  15s/30s read pacing and remembers cooldowns.
- Unit, contract and workerd integration tests; CI with secret scanning.
