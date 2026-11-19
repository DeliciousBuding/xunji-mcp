# ADR 0002 — OAuth 2.1, operator identity and the single-user allowlist

- Status: accepted
- Date: 2026-11-19

## Context

ChatGPT and other MCP clients require a real OAuth 2.1 authorization-code flow
with PKCE. A static bearer token pasted into a client is not acceptable: it
cannot be revoked per client, it does not bind a user identity, and it turns a
public URL into a shared secret.

At the same time this bridge serves exactly one operator's Xunji account. Public
dynamic client registration must not become a path to that account.

## Decision

Use `@cloudflare/workers-oauth-provider` as the authorization server:

- RFC 9728 protected-resource metadata at `/.well-known/oauth-protected-resource/mcp`
  with a canonical `resource` equal to the MCP URL and one `authorization_servers`
  entry (this origin).
- RFC 8414 authorization-server metadata with S256, `resource` support,
  RFC 9207 `iss` on every authorization response, revocation endpoint and
  refresh-token rotation.
- CIMD enabled (preferred by current clients) and DCR kept for older clients.
  Registration alone grants nothing: a grant requires operator approval.
- `requiredScopes: ["xunji:read"]`; `xunji:write` and `offline_access` are
  advertised only when the deployment enables writes.

Operator identity is an authorization-time gate, not a second token system:

1. **Cloudflare Access (recommended).** The `/authorize` path is placed behind
   an Access application with a single-email policy. The Worker verifies the
   `Cf-Access-Jwt-Assertion` signature against the team JWKS, checks issuer,
   audience, expiry and algorithm, then requires the email to be in
   `ALLOWED_USER_EMAILS`. No header, no identity, no grant.
2. **Deployment passphrase (fallback).** For self-hosting outside Cloudflare,
   `OWNER_PASSPHRASE` is compared in constant time over SHA-256 digests. It is
   a deployment secret, not a user password store; there is one operator.

If neither is configured, `/authorize` returns 503 and no grant can be created.
There is no "allow all" mode.

Token props carry `{ subject, label, scope }`, where `subject` is a truncated
SHA-256 of the operator identity. The vendor key is never placed in props, a
token, a log line or a cache key.

## Consequences

- Revoking a client is a first-class operation (provider `deleteClient` /
  token revocation), unlike a pasted static token.
- Access mode adds an operational dependency: the Access app and its AUD tag
  must exist for `/authorize`, while `/mcp`, `/oauth/*` and `/.well-known/*`
  stay reachable for machine clients.
- A misconfigured Access policy fails closed because the Worker independently
  verifies the JWT and the email allowlist; it never trusts an unsigned header.
- Passphrase mode is weaker than an IdP (phishing, reuse). It exists for
  portability, is documented as such, and is not the default path.
