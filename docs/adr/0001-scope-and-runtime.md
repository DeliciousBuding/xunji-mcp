# ADR 0001 — Scope, runtime and shape of the bridge

[English](0001-scope-and-runtime.md) · [简体中文](0001-scope-and-runtime.zh-CN.md)

- Status: accepted
- Date: 2026-11-19

## Context

Xunji (训记) publishes a personal training-data Open API that is designed for
LLM agents: one HTTP call per calendar day, a bearer key bound to one account,
and no query language. The goal is to make that data usable from ChatGPT and
other MCP clients without building a fitness product, copying the user's
history into a second source of truth, or shipping a heavyweight frontend.

Constraints that shaped this decision:

- The vendor key belongs to exactly one person. A public, multi-tenant service
  would have to store other people's keys; that is out of scope.
- The vendor paces reads per (key, day): 15 seconds for the light payload and
  30 seconds for `include_full_data`. Any range query costs wall-clock time.
- The vendor's write endpoint can return HTTP 200 with an application failure,
  and ignores `dry_run`. Every request to it must be treated as a real write.
- MCP authorization is OAuth 2.1 with protected-resource metadata, PKCE S256,
  resource indicators and (increasingly) Client ID Metadata Documents.

## Decision

Ship a single Cloudflare Worker that is both the MCP resource server and its
OAuth 2.1 authorization server, using two maintained libraries:

- `@cloudflare/workers-oauth-provider` for OAuth (discovery, DCR, CIMD, PKCE,
  token rotation, revocation, RFC 9207 `iss`, RFC 8707 `resource`).
- `@modelcontextprotocol/sdk` for the MCP Streamable HTTP endpoint.

The Worker holds upstream domain keys as secrets, normalizes responses and
exposes read tools plus an explicitly enabled write tool. Current state is:

1. Provider-owned `OAUTH_KV` for clients, grants and tokens.
2. `CACHE_KV` for unwrapped training responses for today/yesterday, scoped by
   subject hash and light/full mode, plus the public movement catalog.
3. `UpstreamGate` Durable Objects for subject/date/mode reservation and
   cooldown timestamps.
4. Optional D1 `DB` for derived sessions, movements, sets, scan states,
   metadata and UTC-day budget counters.
5. Optional `ScanCoordinator` Durable Object for a resumable alarm loop over
   the D1 scan queue.

D1 enables grouped queries, an overview and movement progress without one
upstream call per day during analysis. The scan coordinator enables background
backfill/refresh. A daily cron fills the tail through yesterday after the
history start is configured. Xunji remains authoritative; the index can be
rebuilt from successful reads.

The public repository contains generic code and synthetic examples.
Deployment values live in gitignored `wrangler.jsonc` and Worker secrets.
This is one account per deployment; the D1 schema has no subject partition.

An optional MCP Apps resource renders the overview's existing structured
result. It is enabled with `MCP_UI_ENABLED=true`, needs D1 and training read
access, and introduces no separate frontend service, network requests or
storage.

## Consequences

- Legacy range reads cover at most 31 days (overview/statistics) or 62 days
  (movement history), with two successful uncached reads per call and explicit
  `pending`/`deferred` output. They do not read D1 or advance a persistent cursor.
  Historical dates are not written to the hot cache.
- Indexed queries use bounded SQL aggregation and report scan coverage. A
  successful query over a partial index does not establish an empty period.
- Cache writes use a D1 budget (default 300 attempts per UTC day); without D1,
  new cache writes are skipped. Scans skip KV and default to 100 attempted dates
  per UTC day. These are deployment defaults, not account-wide quota guarantees.
- Single-tenant is explicit. Multi-user would require per-user vendor keys and
  a different threat model; the code does not pretend to support it.
- Training writes register only with enabled training, read scope,
  `WRITE_TOOLS_ENABLED=true` and write scope, and calls require
  `confirmed: true`. They do not update D1 or invalidate full-mode cache entries.
- Because the vendor has no delete API, the bridge never claims to delete.
  Corrections are upserts by `localid`; deletions happen in the Xunji app.
- Independent body/nutrition adapters are optional and remain unverified live.
  They require their own keys and domain flags.
- D1 day replacement spans batches; it is not one transaction covering all
  facts and scan status. Operators must inspect coverage after refresh.

See [architecture](../architecture.md), [coverage](../coverage.md) and
[ADR 0003](0003-upstream-contract-and-write-safety.md).
