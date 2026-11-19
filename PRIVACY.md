# Privacy

This bridge is self-hosted. The operator runs it, pays for it, and controls the
data path. There is no upstream service operated by this project.

## What is stored

| Data | Location | Lifetime |
|---|---|---|
| OAuth clients, grants, access/refresh tokens (hashed) | Cloudflare KV (`OAUTH_KV`) | Access 1h; refresh 30 days idle; clients 90 days |
| Normalized training days | Cloudflare KV (`CACHE_KV`), keyed by a hashed subject | 60s (today), 15m (future), 6h (past) |
| Rate-limit timestamps | Durable Object storage | Until overwritten |
| Cloudflare request logs | Cloudflare | Per plan/retention setting |

The bridge does **not** store the Xunji account key in KV, D1, logs or token
props. It lives only as a Worker secret.

## What is sent where

- Browser → this Worker: OAuth parameters and consent form data.
- This Worker → Xunji (`trains.xunjiapp.cn`, `api.xunjiapp.cn`): read/write
  requests with the operator's key. Nothing is sent to the project maintainers.
- This Worker → your MCP client: only the requested normalized data.
- Cloudflare Access (if enabled) authenticates the operator at `/authorize`.

No analytics, telemetry, third-party scripts or fonts are included. The consent
page ships inline CSS only.

## Logs

Application logs contain no request bodies, no upstream payloads, no API key,
no tokens and no email addresses. `/healthz` returns booleans and counts only.
Cloudflare's own platform logs are governed by the operator's Cloudflare
settings.

## Your rights and controls

- Delete the OAuth grant in your MCP client, or revoke it server-side.
- Rotate or revoke the Xunji key in the Xunji app; the bridge immediately loses
  access.
- Delete the KV namespaces and the Worker to remove all bridge-side copies.
- Cached data is ephemeral by design and expires without action.

## Children and medical use

The bridge exposes recorded training data. It is not a medical device and does
not provide diagnosis or treatment advice. Tool descriptions tell agents to
avoid presenting the data as medical advice.

## Contact

Use the repository's security advisory or issue tracker for privacy questions.
