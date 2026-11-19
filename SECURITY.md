# Security policy

[English](SECURITY.md) | [简体中文](SECURITY.zh-CN.md)

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/DeliciousBuding/xunji-mcp/security/advisories/new).
Include the affected version/path, a minimal synthetic reproduction and the
impact. Keep credentials, personal records and private deployment details out
of the report. Do not report vulnerabilities in a public issue.

## Deployment assumptions

One deployment serves one operator's Xunji account. Every authorized client
reads that account, including its shared D1 index. Hashed cache subjects do not
make this a multi-tenant service.

Before exposing an instance publicly:

1. Configure Cloudflare Access for `/authorize`, with `ACCESS_TEAM_DOMAIN`,
   `ACCESS_AUD` and an `ALLOWED_USER_EMAILS` allowlist containing only the
   operator. The Worker verifies the JWT signature, issuer, audience and expiry.
   Passphrase mode is an alternative using a long random `OWNER_PASSPHRASE`.
   Authorization fails closed when neither mode is configured.
2. Disable the `workers.dev` route with `workers_dev: false`. Access policies
   are host-scoped; an alternate route may bypass the Access application, though
   the Worker's identity verification still applies.
3. Remove the deployed `OWNER_PASSPHRASE` once Access works. A configured
   passphrase remains an alternative authorization path on any reachable host.
   Keep an emergency copy only in the operator's password manager.
4. Keep `WRITE_TOOLS_ENABLED=false` unless a real write is needed. Enabling
   writes also requires a token with `xunji:write` and `confirmed: true` for each
   call. The bridge never sends `dry_run` and provides no delete operation.
5. Store each vendor key as a Worker secret. Enable optional domains only with
   their matching keys; their live verification is still pending.
6. Review health/discovery and authorization rejection behaviour. Keep
   `/admin/*` disabled unless needed; it has a separate `ADMIN_TOKEN`, and its
   coverage output may reveal dates and counts.

## Secrets that must never be committed

| Secret or private setting                                 | Storage                                        |
| --------------------------------------------------------- | ---------------------------------------------- |
| `XUNJI_API_KEY`                                           | Worker secret for training/plan access         |
| `XUNJI_BODY_KEY`                                          | Optional Worker secret for body measurements   |
| `XUNJI_FOOD_KEY`                                          | Optional Worker secret for food records        |
| `XUNJI_FOOD_SEARCH_KEY`                                   | Optional Worker secret for food catalog search |
| `OWNER_PASSPHRASE`                                        | Worker secret in passphrase mode               |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ALLOWED_USER_EMAILS` | Private deployment secrets/vars as appropriate |
| `ADMIN_TOKEN`                                             | Optional Worker secret for `/admin/*`          |
| Cloudflare API token                                      | Private local environment or CI secret         |

`.gitignore` excludes `wrangler.jsonc`, `.dev.vars`, `.env*` and `.local/`.
CI scans for credential patterns. Use synthetic fixtures and example domains;
pattern scanning does not replace review of records, screenshots and history.

If a key is exposed, revoke/rotate it in Xunji and replace the matching Worker
secret. Revoke affected OAuth grants as well. Rotation does not clear indexed
history or client copies; follow [Privacy](PRIVACY.md) for storage cleanup.
Operator confirmation of key rotation remains pending in the
[verification record](docs/acceptance.md).

## Quota isolation

The free Workers KV allowance is account-wide and write-bound. This project does
not spend it on historical reads:

- Scans write D1 only and are capped at `SCAN_DAILY_LIMIT` (default 100) days per
  UTC day.
- KV is a hot-key cache for today/yesterday, capped at
  `KV_WRITE_DAILY_BUDGET` (default 300) writes/day.
- `/admin/*` and `xunji_history` report the counters; over-budget writes are
  skipped and marked `budgetDegraded`.

These are per-deployment guardrails, not reservations of account-wide quota.
OAuth provider KV writes and other Workers also consume the account allowance.

## Access and capability limits

`/mcp` uses the OAuth provider; a static admin token is not a substitute for an
MCP grant. The `xunji:read` scope includes index backfill/refresh controls, which
change bridge storage while only reading Xunji.

Body, nutrition and food-search adapters are implemented. Registration requires
both the corresponding `body`/`nutrition` entry in `ENABLED_DATA_DOMAINS` and
the separate vendor secret. They remain marked `verified: false`; having a key
does not establish live compatibility.

Personal template mutation and upstream deletion are outside the exposed
surface. Correct training sessions through `localid` upsert or the Xunji app.
For the full model, see [Threat model](docs/threat-model.md).
