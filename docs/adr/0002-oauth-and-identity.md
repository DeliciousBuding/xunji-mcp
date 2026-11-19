# ADR 0002 — OAuth 2.1, operator identity and the single-user allowlist

[English](0002-oauth-and-identity.md) · [简体中文](0002-oauth-and-identity.zh-CN.md)

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
  RFC 9207 `iss` on provider redirects, revocation endpoint and
  refresh-token rotation.
- CIMD enabled (preferred by current clients) and DCR kept for older clients.
  Registration alone grants nothing: a grant requires operator approval.
- `requiredScopes: ["xunji:read"]` advertises the baseline in resource
  metadata and challenges. The application checks scope during tool registration.
- Provider `scopesSupported` statically advertises `xunji:read`,
  `xunji:write` and `offline_access`. The authorization page allows read
  scope, and write scope only when `WRITE_TOOLS_ENABLED=true`; it filters
  `offline_access` out of grants.
- Access tokens last one hour. Refresh tokens rotate on use, with a 30-day
  initial lifetime and a 30-day sliding idle lifetime on refresh. Client
  registration TTL is 90 days. Refresh behavior is supplied by the provider,
  independently of the bridge's `offline_access` consent filtering.

Operator identity is an authorization-time gate, not a second token system:

1. **Cloudflare Access (recommended).** The `/authorize` path is placed behind
   an Access application with a single-email policy. The Worker verifies the
   `Cf-Access-Jwt-Assertion` signature against the team JWKS, checks issuer,
   audience, expiry and algorithm, then requires the email to be in
   `ALLOWED_USER_EMAILS`. No header, no identity, no grant.
2. **Deployment passphrase (fallback).** For deployments without Access,
   `OWNER_PASSPHRASE` is compared in constant time over SHA-256 digests. It is
   a deployment secret, not a user password store; there is one operator.

If neither is configured, `/authorize` returns 503 and no grant can be created.
If Access is configured without a passphrase, a request lacking a verified,
allowlisted JWT returns 403. If both are configured, a valid passphrase can
still authorize when Access identity is absent. Remove the fallback when
Access is working.

Token props carry `{ subject, label, scope }`, where `subject` is a truncated
SHA-256 of the operator identity. The provider encrypts props; grant user IDs
and metadata remain storage-visible. The label is a sanitized email local part
or a fallback operator label. Upstream keys are excluded from props, tokens
and cache keys.

## Consequences

- The provider supports RFC 7009 revocation at `/oauth/token` and
  `revokeGrant`/`deleteClient` helpers. The application exposes no grant
  administration endpoint. Deleting a connector or changing the operator gate
  should not be treated as proof that a server-side grant was revoked.
- Access mode adds an operational dependency: the Access app and its AUD tag
  must exist for `/authorize`, while `/mcp`, `/oauth/*` and `/.well-known/*`
  stay reachable for machine clients.
- A misconfigured Access policy fails closed because the Worker independently
  verifies the JWT and the email allowlist; it never trusts an unsigned header.
- Passphrase mode is weaker than an IdP (phishing, reuse). It exists for
  deployments without Access. The runtime remains Cloudflare Workers.
- Alternate hostnames need the same gate or must be disabled. In Access-only
  mode, missing identity still fails closed in the Worker.
- Multiple allowlist entries do not provide separate Xunji accounts. D1 and the
  upstream keys belong to the deployment's single account.
- Disabling writes removes write-tool registration even from an existing token
  with write scope. Changing Access/passphrase settings controls future consent;
  existing OAuth grants have their own lifetimes and revocation path.

See [deployment](../deployment.md), [ChatGPT connection](../chatgpt-connect.md)
and [the threat model](../threat-model.md).
