# Changelog

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
