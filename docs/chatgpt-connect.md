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
4. `/authorize` protected by Access or configured with `OWNER_PASSPHRASE`.

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

## Revoking access

Revoke the connector in ChatGPT settings, or remove the grant server-side with
the provider's `deleteClient`/grant helpers. Access tokens expire within an
hour; refresh tokens expire after 30 idle days.
