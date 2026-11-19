# Threat model

Scope: a self-hosted, single-operator bridge between an MCP client (ChatGPT,
Claude, Cursor, …) and one Xunji account. The deployment is publicly reachable
at an HTTPS origin so that a hosted MCP client can reach it.

## Assets

| Asset                         | Where it lives                                                | Impact if disclosed                                       |
| ----------------------------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| Xunji API key                 | Worker secret (`XUNJI_API_KEY`)                               | Full read/write access to the operator's training history |
| Training history              | Xunji servers; normalized copies in D1 and a hot-key KV cache | Health and habit inference about one person               |
| OAuth grants / refresh tokens | Provider KV (`OAUTH_KV`)                                      | Access to this bridge until revoked                       |
| Operator identity             | Access JWT / passphrase, token props                          | Impersonation of the operator at the consent step         |
| Deployment configuration      | gitignored `wrangler.jsonc`, secrets                          | Availability, wrong-origin OAuth metadata                 |
| Operator console              | `/admin/*` behind `ADMIN_TOKEN`                               | Index/backfill control, aggregate counts                  |

## Trust boundaries

1. **Client → Worker.** Untrusted input: OAuth parameters, MCP JSON-RPC, bearer
   token, headers. The provider validates tokens; the handler validates tool
   arguments with Zod; the upstream key is added server-side.
2. **Worker → Xunji.** Outbound only. The key is never echoed; upstream bodies
   are size-capped and parsed before use.
3. **Browser → `/authorize`.** CSRF-protected by the provider's browser-bound,
   single-use consent handle. Identity comes from Access or the passphrase.
4. **Operator → deployment.** Secrets are set with `wrangler secret put`; the
   public repository contains no real origin, account or credential.

## Threats and controls

| #   | Threat                                                                               | Control                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Stranger completes OAuth with a self-registered client and reads the operator's data | Grant requires operator identity: Access JWT verified against JWKS + email allowlist, or the deployment passphrase. Registration alone grants nothing.                                      |
| T2  | Stolen/forged bearer token                                                           | Opaque random tokens stored hashed; audience checked against the canonical resource; 1h access TTL; refresh rotation with idle expiry; revocation endpoint.                                 |
| T3  | Redirect-URI hijack / open redirect                                                  | Provider enforces exact registered redirect URIs, HTTPS (or loopback), no fragments/userinfo, and validates `resource` on authorize and token.                                              |
| T4  | CSRF on consent                                                                      | `beginConsent()` issues a browser-bound, single-use handle; POST without the binding cookie is rejected. Error pages are never redirects unless the client and redirect URI were validated. |
| T5  | Consent-page XSS via client metadata                                                 | All client-supplied strings are HTML-escaped; CSP `default-src 'none'`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, no client JS.                                                    |
| T6  | SSRF via CIMD `client_id` URL                                                        | Provider fetches CIMD with `global_fetch_strictly_public`, HTTPS-only, size and time bounds.                                                                                                |
| T7  | Cross-user leakage                                                                   | KV keys include a SHA-256 subject prefix derived from the verified identity; D1 is explicitly single-tenant (one deployment per Xunji account); no endpoint accepts a user identifier.      |
| T8  | Accidental destructive write                                                         | Write tools absent unless `WRITE_TOOLS_ENABLED=true` **and** the token has `xunji:write`; `confirmed: true` required; ±6 months window; no delete; no `dry_run` illusion.                   |
| T9  | Vendor rate-limit burn / self-DoS                                                    | Per-day Durable Object reservation, bounded waits, cooldown memory, two-read budget per range call, cache-first reads, 100-day/day scan budget, resumable backfill.                         |
| T10 | Key leakage through logs/errors                                                      | No request bodies, headers or upstream payloads are logged. Error mapping replaces vendor text with typed codes. Health output reports booleans only.                                       |
| T11 | Prompt injection from training notes                                                 | Notes are opt-in, returned as data fields, and tool descriptions state they are untrusted content. No tool executes text.                                                                   |
| T12 | Resource exhaustion                                                                  | 32 KiB MCP body cap, 2 MiB upstream body cap, 15s upstream timeout, bounded range/history windows, single-tenant shape, 300/day KV write budget.                                            |
| T13 | Token replay after revoke                                                            | Provider revokes all tokens for a client on `deleteClient`; access tokens expire within 1h; refresh idle expiry 30d.                                                                        |
| T14 | Admin endpoint abuse or token leak                                                   | `ADMIN_TOKEN` is a Worker secret compared in constant time; `/admin/*` returns counts and control only, never training payloads; unauthenticated requests get 401.                          |
| T15 | Account-wide KV quota starvation                                                     | Scans never write KV; KV writes are capped at 300/day through a D1 counter and skip to degraded mode; account exhaustion is treated as a first-class failure, not a per-Worker concern.     |

## Out of scope

- Compromise of the Xunji vendor itself.
- A malicious MCP client that the operator deliberately authorized — it can read
  what the operator granted, by design.
- Multi-tenant key custody. The code assumes one Xunji key per deployment.
- Writes in the default deployment: disabled.

## Residual risks

- Passphrase mode can be phished or reused; Access mode is recommended.
- A host compromise exposes the Worker secret. Rotate the Xunji key from the
  Xunji app if that is suspected.
- The D1 index holds a derived copy of the operator's full history until the
  operator clears it; it is single-tenant and must be treated as sensitive.
  KV only holds today/yesterday hot entries (minutes), the movement catalog, and
  OAuth grants; treat the Cloudflare account as part of the trust boundary.
- The vendor has no delete API, so a mistaken write must be corrected in the
  Xunji app or overwritten by a later upsert.
