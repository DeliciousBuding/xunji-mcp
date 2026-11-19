# Connecting ChatGPT

[English](chatgpt-connect.md) · [简体中文](chatgpt-connect.zh-CN.md)

ChatGPT's custom connectors use the MCP authorization contract: protected
resource metadata, authorization-server metadata, and an authorization-code
flow with PKCE. The bridge implements that connection path. Client UI names
and availability depend on the ChatGPT plan and workspace.

> Compatibility is verified per deployment. Until you complete this flow in your
> own workspace, OAuth, tool use and optional MCP Apps rendering remain
> separate checks.

## Prerequisites

1. A deployed Worker on an HTTPS origin (see [deployment.md](deployment.md)).
2. ChatGPT custom connectors available in your plan and workspace.
3. The origin reachable from your browser and from OpenAI's backend.
4. `/authorize` protected by Access, or configured with `OWNER_PASSPHRASE`.
   Prefer Access. If Access is configured, remove the passphrase so it cannot
   act as a second key (see [deployment.md](deployment.md#harden-the-operator-gate)).

## 1. Add the connector

1. Open ChatGPT settings and the custom connector/app controls. Existing
   interfaces may label them **Connectors**, **Advanced** or **Developer mode**;
   use the controls available in your workspace.
2. Create a custom connector with the MCP URL:
   `https://exercise.example.com/mcp` (replace the example origin).
3. Authentication: **OAuth**. Keep the Xunji key in the Worker secret; the
   client receives provider-issued OAuth tokens.

Use the exact redirect URI and client identity supplied by the client.
CIMD is enabled; DCR at `/oauth/register` is available for clients that need
it. A CIMD client uses its metadata URL as its identity and does not need a
separate DCR request. Registration alone grants no access.

## 2. Complete the browser flow

1. ChatGPT opens `https://exercise.example.com/authorize?...` with `state`,
   `code_challenge`, `resource` and scopes.
2. If Access protects the page, sign in there.
3. The consent page names the client, the redirect host and the scopes, and asks
   for the deployment passphrase if you are not using Access.
4. Approve. The bridge redirects to ChatGPT's callback with `code`, `state` and
   `iss`.
5. ChatGPT exchanges the code with its PKCE verifier at `/oauth/token`.

The authorization page refuses an unverified operator or invalid/expired
consent. Invalid requests can produce a local error page; approved and denied
provider redirects include `iss`.

The provider advertises `xunji:read`, `xunji:write` and `offline_access`.
The current consent handler grants read and, only when enabled, write; it
filters `offline_access` out. Refresh-token rotation and the 30-day idle
lifetime are implemented by the provider separately.

## 3. Verify

Confirm tool discovery, then ask the model to call:

```text
xunji_capabilities
```

This reports configuration and index counters, not a live validation of the
upstream key. The capability matrix can differ from the tools available to
the current token; use the connector's actual tool inventory.

For a D1 deployment with a history start/backfill, call:

```json
{ "range": { "preset": "all_time" }, "includeToday": false }
```

with `xunji_training_overview`. Inspect the returned range and
`coverage.complete`, pending/error counts and freshness before interpreting
the KPIs. A successful partial query is not a completed-history check.

For a direct read, choose a private date and replace the placeholder:

```text
xunji_get_training_day  {"date":"YYYY-MM-DD"}
```

Compare the returned counts/aggregates with the Xunji app privately. A
`no_training` day is a valid empty read; a deferred read requires waiting for
the retry hint. Keep dates, titles, weights, account identifiers and deployment
details out of public screenshots or verification reports.

Legacy range/statistics tools have a two-uncached-read budget and explicit
`pending`/`deferred`. Narrow follow-up requests to pending days, or use the
index; repeating a historical range is not pagination.

## Optional MCP Apps rendering

The operator can set `MCP_UI_ENABLED=true` with D1 and training enabled.
The overview tool then links `ui://xunji/overview` as
`text/html;profile=mcp-app` using `_meta.ui.resourceUri` and
`openai/outputTemplate`.

The view uses the existing structured result, has Simplified Chinese labels,
and makes no network requests or storage writes. Confirm separately that the
host discovers the resource and renders KPIs/monthly volume. A successful
overview tool call does not establish app rendering; a host without support
can keep using text and structured data.

## Troubleshooting

| Symptom                                                          | Likely cause                                                                                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Connector reports "OAuth not supported"                          | AS metadata missing S256 or discovery path wrong; check `/.well-known/oauth-authorization-server`                                       |
| `invalid_redirect_uri`                                           | The client reused a redirect URI not present in its registration/CIMD document                                                          |
| Authorization page 403 with "Access did not provide an identity" | `/authorize` is not behind Access, or the JWT audience/team is misconfigured                                                            |
| 401 after connecting                                             | Token audience does not equal `PUBLIC_ORIGIN + /mcp`; check `PUBLIC_ORIGIN`                                                             |
| `deferred` results                                               | The vendor is pacing reads; wait `retryAfterSeconds` and retry                                                                          |
| Writes unavailable                                               | Expected: `WRITE_TOOLS_ENABLED=false` by default                                                                                        |
| New tools missing after a bridge upgrade                         | Check token scopes/domain flags first; the client may cache inventory. Refresh or reconnect using its controls, or remove and re-add it |
| Indexed query reports incomplete coverage                        | Backfill/refresh is still pending, failed or outside the configured start; inspect `xunji_history`                                      |
| Overview succeeds but no app view appears                        | UI flag or resource missing, or the host does not render MCP Apps; check inventory separately                                           |

## Re-authenticating

Removing `OWNER_PASSPHRASE` changes future consent, not existing OAuth grants.
An existing client can continue while its tokens remain valid. Run the browser
flow again to reconnect after revocation/expiry, or to request newly enabled
write scope. If tools are missing, first check actual scope and configuration.

1. In ChatGPT, open the connector and choose **Reconnect** (or remove and add it
   again with the same `/mcp` URL).
2. The browser opens `/authorize`. Cloudflare Access asks you to sign in with
   the identity provider configured on the Access application (email one-time
   code, or your SSO).
3. Approve the consent page. ChatGPT receives a new code and exchanges it for a
   fresh access/refresh token.

In Access-only mode, the operator uses the Access login. A still-valid Access
session may avoid another sign-in prompt.

### If Access itself is broken

Recovery is deliberately manual and temporary:

```bash
# 1. Temporarily configure a high-entropy passphrase
printf '%s' "$NEW_PASSPHRASE" | npx wrangler secret put OWNER_PASSPHRASE

# 2. Complete the consent flow with that passphrase
# 3. Fix the Access application (policy, AUD, team domain), verify /authorize
#    redirects to the Access login again, then remove the fallback
npx wrangler secret delete OWNER_PASSPHRASE
```

The Worker accepts the passphrase when no Access identity is available even
if Access settings remain configured. It does not bypass an Access gateway
that blocks the browser before the Worker; restoring that route remains an
operator task. Remove the fallback after recovery.

## Revoking access

Use the client's revoke controls when available, or revoke the server-side
grant with the provider's `revokeGrant`/`deleteClient` helpers. The bridge has
no grant-administration endpoint. Removing a client entry from a UI should not
be treated as proof of server-side revocation.

Access tokens last one hour; refresh grants use a 30-day sliding idle lifetime.
Revocation, token expiry and changes to the operator sign-in gate are different
operations. See [the identity ADR](adr/0002-oauth-and-identity.md),
[coverage](coverage.md) and [the threat model](threat-model.md).
