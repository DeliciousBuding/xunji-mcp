# Threat model

[English](threat-model.md) · [简体中文](threat-model.zh-CN.md)

Scope: a self-hosted, single-operator bridge between an MCP client (ChatGPT,
Claude, Cursor, …) and one Xunji account. The deployment is publicly reachable
at an HTTPS origin so that a hosted MCP client can reach it.

## Assets

| Asset                         | Where it lives                                                              | Impact if disclosed                                               |
| ----------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Xunji domain keys             | Worker secrets (`XUNJI_API_KEY` and optional independent domain keys)       | Upstream access to the operator's data, including training writes |
| Training history              | Xunji servers; derived D1 facts and unwrapped responses in the hot KV cache | Health and habit inference about one person                       |
| OAuth grants / refresh tokens | Provider KV (`OAUTH_KV`)                                                    | Access to this bridge until revoked                               |
| Operator identity             | Access JWT / passphrase, token props                                        | Impersonation of the operator at the consent step                 |
| Deployment configuration      | gitignored `wrangler.jsonc`, secrets                                        | Availability, wrong-origin OAuth metadata                         |
| Operator console              | `/admin/*` behind `ADMIN_TOKEN`                                             | Index/backfill control, coverage metadata and tool inventory      |

## Trust boundaries

1. **Client → Worker.** Untrusted input: OAuth parameters, MCP JSON-RPC, bearer
   token, headers. The provider validates tokens; the handler validates tool
   arguments with Zod; the upstream key is added server-side.
2. **Worker → Xunji.** Outbound requests use server-side domain keys. The
   response buffer is checked before the client's gzip decompression; payloads
   are parsed and mapped into tool output.
3. **Browser → `/authorize`.** CSRF-protected by the provider's browser-bound,
   single-use consent handle. Identity comes from Access or the passphrase.
4. **Operator → deployment.** Secrets are set with `wrangler secret put`; the
   public repository contains no real origin, account or credential.
5. **Worker → MCP Apps host.** The optional overview view receives the same
   structured result through parent-window messages. The host supplies the
   sandbox; the view formats data, makes no network requests and stores nothing.

## Threats and controls

| #   | Threat                                                                               | Control                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T1  | Stranger completes OAuth with a self-registered client and reads the operator's data | Grant requires operator identity: Access JWT verified against JWKS + email allowlist, or the deployment passphrase. Registration alone grants nothing.                                                                                                 |
| T2  | Stolen/forged bearer token                                                           | Opaque random tokens stored hashed; audience checked against the canonical resource; 1h access TTL; refresh rotation with idle expiry; revocation endpoint.                                                                                            |
| T3  | Redirect-URI hijack / open redirect                                                  | Provider enforces exact registered redirect URIs, HTTPS (or loopback), no fragments/userinfo, and validates `resource` on authorize and token.                                                                                                         |
| T4  | CSRF on consent                                                                      | `beginConsent()` issues a browser-bound, single-use handle; POST without the binding cookie is rejected. Error pages are never redirects unless the client and redirect URI were validated.                                                            |
| T5  | Consent-page XSS via client metadata                                                 | All client-supplied strings are HTML-escaped; CSP `default-src 'none'`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, no client JS.                                                                                                               |
| T6  | SSRF via CIMD `client_id` URL                                                        | Provider fetches CIMD with `global_fetch_strictly_public`, HTTPS-only, size and time bounds.                                                                                                                                                           |
| T7  | Cross-user leakage                                                                   | KV keys include a SHA-256 subject prefix derived from the verified identity; D1 is explicitly single-tenant (one deployment per Xunji account); no endpoint accepts a user identifier.                                                                 |
| T8  | Accidental destructive write                                                         | Enabled `train` domain, read scope, `WRITE_TOOLS_ENABLED=true` and write scope required; literal `confirmed: true`; 190-day date guard; no delete or `dry_run`.                                                                                        |
| T9  | Vendor rate-limit burn / self-DoS                                                    | Subject/date/mode Durable Object reservations, bounded waits and cooldowns; range budget of two successful uncached reads; resumable scans with a default budget of 100 attempts per UTC day.                                                          |
| T10 | Key leakage through logs/errors                                                      | Upstream requests are not logged by the client; unknown vendor errors become generic codes/messages. Current Worker logs include tool-list names/counts and authorization failure name/message.                                                        |
| T11 | Prompt injection from training notes                                                 | Session note text is opt-in, but movement/set notes can still appear. Returned text is data; no tool executes it. Clients must preserve that boundary.                                                                                                 |
| T12 | Resource exhaustion                                                                  | 32 KiB MCP body cap; 2 MiB fetched-buffer check; default 15s fetch-to-headers timeout; bounded training queries and write payloads; default 300-attempt cache budget.                                                                                  |
| T13 | Token replay after revoke                                                            | Provider revokes all tokens for a client on `deleteClient`; access tokens expire within 1h; refresh idle expiry 30d.                                                                                                                                   |
| T14 | Admin endpoint abuse or token leak                                                   | Secret comparison uses SHA-256 digests and a constant-time comparison loop; admin responses expose index metadata/control and tool/resource inventory, not training payloads. Missing token configuration returns 404; invalid credentials return 401. |
| T15 | Account-wide KV quota starvation                                                     | Scans skip KV. Cache writes use a D1 counter and are skipped after the configured UTC-day budget or on failure. Provider-owned OAuth writes are outside this cache budget.                                                                             |

## Out of scope

- Compromise of the Xunji vendor itself.
- A malicious MCP client that the operator deliberately authorized — it can read
  what the operator granted, by design.
- Multi-tenant key custody. One deployment serves one Xunji account, with
  independent keys for optional data domains.
- Writes in the default deployment: disabled.
- Body/nutrition live response verification; their adapters require independent
  keys and enabled domains.

## Residual risks

- Passphrase mode can be phished or reused. Access mode is recommended, and
  `OWNER_PASSPHRASE` should be removed once Access works: it is a second key
  that is valid from any hostname that reaches the Worker.
- Alternate hostnames such as `workers.dev` can bypass host-scoped Access
  policies. Disable unused routes. Without a configured passphrase, the Worker
  still requires a valid, allowlisted Access JWT before it grants consent.
- A host compromise exposes the Worker secret. Rotate the Xunji key from the
  Xunji app if that is suspected.
- The D1 index holds derived facts for the indexed window until the
  operator clears it; it is single-tenant and must be treated as sensitive.
  `CACHE_KV` holds today/yesterday responses for minutes and the public movement
  catalog; `OAUTH_KV` separately holds OAuth state. Hot entries can contain
  full-mode notes even when the tool response omits session note text.
  Treat the Cloudflare account as part of the trust boundary.
- The vendor has no delete API, so a mistaken write must be corrected in the
  Xunji app or overwritten by a later upsert.
- D1 replacement and scan status span several batches, so a failed refresh can
  leave partial facts. Day reads and writes do not update D1, and writes do not
  invalidate the full-mode hot cache.
- Gate isolation is per subject/date/mode, not globally per upstream key.
  Admin/cron scans and OAuth reads can use different subjects for the same
  account. Independent entries therefore do not guarantee global pacing.
- The fetch timer ends at response headers. Body reading/decompression have
  no separate timeout or inflated-size limit. Optional domain ranges do not
  use the legacy training-range caps.
- The authorization-failure log currently includes the provider error message.
  Do not add request bodies, credentials, identity details or vendor payloads
  to logs; review platform logging configuration as part of deployment.
- Capability `verified`/`ready` markers do not prove live credential validity,
  complete index coverage or client rendering.

See [architecture](architecture.md) for state and read paths,
[coverage](coverage.md) for verification semantics and
[deployment](deployment.md) for operator-gate configuration.
