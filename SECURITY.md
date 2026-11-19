# Security policy

## Reporting a vulnerability

Open a private security advisory on the GitHub repository, or email the
maintainer listed there. Do not open a public issue for a vulnerability.
Please include the affected path, a minimal reproduction, and the impact you
believe it has. We aim to acknowledge within a few days.

## Deployment assumptions

This project is designed for **one operator and one Xunji account**. Running it
as a multi-tenant service is outside the threat model: the Worker holds one
vendor key, and every authorized client reads the same account.

Before exposing an instance publicly:

1. Set `ALLOWED_USER_EMAILS` to exactly the operator's address.
2. Protect `/authorize` with Cloudflare Access, or set a long random
   `OWNER_PASSPHRASE`. Never leave both unset expecting access to work — the
   bridge fails closed.
3. Keep `WRITE_TOOLS_ENABLED=false` unless writes are genuinely needed. The
   vendor's write endpoint ignores `dry_run`, so a mistake is a real record.
4. Keep the Xunji key in a Worker secret. Rotate it if it was ever pasted into a
   chat, a ticket, a shell argument or a log.
5. Review deployed `/healthz` output: it must not reveal keys or data.

## Secrets that must never be committed

| Secret                              | Storage                                |
| ----------------------------------- | -------------------------------------- |
| `XUNJI_API_KEY`                     | `wrangler secret put XUNJI_API_KEY`    |
| `OWNER_PASSPHRASE`                  | `wrangler secret put OWNER_PASSPHRASE` |
| `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` | Worker secret or private vars          |
| `ADMIN_TOKEN` (optional `/admin/*`) | Worker secret                          |
| Cloudflare API token                | local environment only                 |

`.gitignore` excludes `wrangler.jsonc`, `.dev.vars`, `.env*` and `.local/`.
A CI secret scan runs on every push.

## Quota isolation

The free Workers KV allowance is account-wide and write-bound. This project does
not spend it on historical reads:

- Scans write D1 only and are capped at `SCAN_DAILY_LIMIT` (default 100) days per
  UTC day.
- KV is a hot-key cache for today/yesterday, capped at
  `KV_WRITE_DAILY_BUDGET` (default 300) writes/day.
- `/admin/*` and `xunji_history` report the counters; over-budget writes are
  skipped and marked `budgetDegraded`.

## What the bridge does not do

- It does not accept a static bearer token as a substitute for OAuth.
- It does not log request bodies, headers, upstream payloads or tokens.
- It does not expose nutrition or body data, because those need different
  vendor keys that this project does not manage.
- It does not delete training records; the upstream API has no such operation.
