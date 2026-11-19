# ADR 0001 — Scope, runtime and shape of the bridge

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
- The vendor's write endpoint returns HTTP 200 with a soft error string, and
  (verified 2026-11-19) **ignores `dry_run`** — a "preview" writes.
- MCP authorization is OAuth 2.1 with protected-resource metadata, PKCE S256,
  resource indicators and (increasingly) Client ID Metadata Documents.

## Decision

Ship a single Cloudflare Worker that is both the MCP resource server and its
OAuth 2.1 authorization server, using two maintained libraries:

- `@cloudflare/workers-oauth-provider` for OAuth (discovery, DCR, CIMD, PKCE,
  token rotation, revocation, RFC 9207 `iss`, RFC 8707 `resource`).
- `@modelcontextprotocol/sdk` for the MCP Streamable HTTP endpoint.

The Worker holds the vendor key as a secret, normalizes responses, computes
aggregates, and exposes a small, read-first tool surface. State is limited to:

1. OAuth KV (grants, tokens, clients) — required by the provider.
2. An identity-scoped read cache in KV (normalized day payloads, short TTL).
3. One Durable Object per (subject, day, mode) that enforces the vendor's
   spacing and records cooldowns. It stores timestamps only.

No D1, no queue, no second service. The public repository contains only generic
code and synthetic fixtures; deployment values live in a gitignored
`wrangler.jsonc` and Worker secrets.

## Consequences

- A range read is intentionally slow and budgeted: at most two uncached
  upstream reads per tool call, with `pending` dates reported so the agent can
  continue. This is honest about the vendor limit instead of hiding it behind a
  long-hanging request.
- Single-tenant is explicit. Multi-user would require per-user vendor keys and
  a different threat model; the code does not pretend to support it.
- Writes exist in code but are registered only when `WRITE_TOOLS_ENABLED=true`
  and the token carries `xunji:write`. Default deployments are read-only.
- Because the vendor has no delete API, the bridge never claims to delete.
  Corrections are upserts by `localid`; deletions happen in the Xunji app.
