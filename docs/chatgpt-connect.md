# Connecting ChatGPT

ChatGPT's custom connectors use the MCP authorization contract: protected
resource metadata, authorization-server metadata, and an authorization-code
flow with PKCE. This bridge implements that contract; the steps below are what
the operator actually does.

> Compatibility is verified per deployment. Until you complete this flow in your
> own workspace, treat ChatGPT support as "implemented", not "verified".

## Prerequisites

1. A deployed Worker on an HTTPS origin (see [deployment.md](deployment.md)).
2. ChatGPT custom connectors available in your plan and workspace.
3. The origin reachable from your browser and from OpenAI's backend.
4. `/authorize` protected by Access, or configured with `OWNER_PASSPHRASE`.
   Prefer Access. If Access is configured, remove the passphrase so it cannot
   act as a second key (see [deployment.md](deployment.md#harden-the-operator-gate)).

## 1. Add the connector

1. Open ChatGPT settings → **Connectors** → **Advanced** / **Developer mode**.
2. Create a custom connector with the MCP URL:
   `https://your-domain.example/mcp`.
3. Authentication: **OAuth**. Do not paste a bearer token; the bridge does not
   accept one outside OAuth.

The connector page shows the exact redirect URI and client metadata document it
will use. CIMD is preferred; DCR is available for older clients. No manual
client registration is needed — and if ChatGPT uses CIMD, there is no
registration step at all.

## 2. Complete the browser flow

1. ChatGPT opens `https://your-domain.example/authorize?...` with `state`,
   `code_challenge`, `resource` and scopes.
2. If Access protects the page, sign in there.
3. The consent page names the client, the redirect host and the scopes, and asks
   for the deployment passphrase if you are not using Access.
4. Approve. The bridge redirects to ChatGPT's callback with `code`, `state` and
   `iss`.
5. ChatGPT exchanges the code with its PKCE verifier at `/oauth/token`.

If any step fails, the page explains why and no grant is created.

## 3. Verify

Ask the model to call:

```text
xunji_capabilities
```

Then:

```text
xunji_get_training_day  {"date":"<a date you trained>"}
```

Confirm the returned title/volume match the Xunji app. Then try
`xunji_training_stats` over the last week.

## Troubleshooting

| Symptom                                                          | Likely cause                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Connector reports "OAuth not supported"                          | AS metadata missing S256 or discovery path wrong; check `/.well-known/oauth-authorization-server` |
| `invalid_redirect_uri`                                           | The client reused a redirect URI not present in its registration/CIMD document                    |
| Authorization page 403 with "Access did not provide an identity" | `/authorize` is not behind Access, or the JWT audience/team is misconfigured                      |
| 401 after connecting                                             | Token audience does not equal `PUBLIC_ORIGIN + /mcp`; check `PUBLIC_ORIGIN`                       |
| `deferred` results                                               | The vendor is pacing reads; wait `retryAfterSeconds` and retry                                    |
| Writes unavailable                                               | Expected: `WRITE_TOOLS_ENABLED=false` by default                                                  |
| New tools missing after a bridge upgrade                         | The connector snapshots its tool list at creation; remove and re-add it, then approve OAuth again |

## Re-authenticating

Removing `OWNER_PASSPHRASE` does not disconnect an existing connector: ChatGPT
keeps using its refresh token until you revoke the connector or the grant. You
only need the browser flow again when you add a connector, re-add one after
removing it, or revoke and reconnect.

1. In ChatGPT, open the connector and choose **Reconnect** (or remove and add it
   again with the same `/mcp` URL).
2. The browser opens `/authorize`. Cloudflare Access asks you to sign in with
   the identity provider configured on the Access application (email one-time
   code, or your SSO).
3. Approve the consent page. ChatGPT receives a new code and exchanges it for a
   fresh access/refresh token.

There is no separate bridge password to remember: the operator identity is the
Access login. If the Access session is still valid, step 2 may be skipped.

### If Access itself is broken

Recovery is deliberately manual and temporary:

```bash
# 1. Put a new high-entropy passphrase back
printf '%s' "$NEW_PASSPHRASE" | npx wrangler secret put OWNER_PASSPHRASE

# 2. Complete the consent flow with that passphrase
# 3. Fix the Access application (policy, AUD, team domain), verify /authorize
#    redirects to the Access login again, then remove the fallback
npx wrangler secret delete OWNER_PASSPHRASE
```

Do not leave the fallback in place "just in case"; that is the state this
section exists to avoid. The passphrase is only a break-glass path.

## Revoking access

Revoke the connector in ChatGPT settings, or remove the grant server-side with
the provider's `deleteClient`/grant helpers. Access tokens expire within an
hour; refresh tokens expire after 30 idle days.
