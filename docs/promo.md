# Promotional copy

[English](promo.md) | [简体中文](promo.zh-CN.md)

Prepared copy for manual posting. Editing this document does not publish it.
Check the [verification scope](acceptance.md) before making compatibility or
performance claims.

## Short

> xunji-mcp connects MCP clients to your own Xunji (训记) training history. Self-hosted on Cloudflare Workers, with OAuth 2.1 + PKCE, a D1 history index and read-only defaults. MIT.
>
> https://github.com/DeliciousBuding/xunji-mcp

## Longer

> xunji-mcp lets ChatGPT and other MCP clients read your own Xunji training history through a self-hosted bridge.
>
> - Runs on Cloudflare Workers; vendor keys stay in Worker secrets.
> - OAuth 2.1 with CIMD/DCR, PKCE S256, resource audience, refresh rotation and revocation.
> - Operator authorization uses a verified Cloudflare Access identity and allowlist, or a deployment passphrase. Client registration alone grants no data access.
> - After backfill, D1 supports history queries, a single-call overview and movement progress, with explicit coverage status.
> - Legacy bounded tools remain available. Per-day vendor pacing, cache and scan budgets are reported through `deferred`, `pending` and degradation metadata.
> - Body and food adapters require separate keys and enabled domains; live verification remains pending.
> - An optional MCP Apps overview displays the existing result. It is off by default, and real ChatGPT rendering remains pending.
> - Training writes are off by default and require `xunji:write` plus `confirmed: true`. Writes are real: the bridge sends no `dry_run` and offers no delete tool.
>
> MIT, no telemetry. https://github.com/DeliciousBuding/xunji-mcp

For numeric comparisons, link the [synthetic benchmark](benchmark.md) with its
method and limits. The D1 index is a persistent copy; data retention and
cleanup are described in [Privacy](../PRIVACY.md).
