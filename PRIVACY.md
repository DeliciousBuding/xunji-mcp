# Privacy

[English](PRIVACY.md) | [简体中文](PRIVACY.zh-CN.md)

xunji-mcp is self-hosted. The operator controls the Cloudflare deployment,
vendor keys, authorized clients and stored copies. Xunji remains the source of
truth; the project maintainers do not receive data from deployed instances.

## What is stored

| Data                                                                                                | Location                                                 | Retention                                                                |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| Vendor keys and operator secrets                                                                    | Worker secrets                                           | Until rotated or removed by the operator                                 |
| OAuth clients, consent/grant and token verification state, pseudonymous subject and operator label  | `OAUTH_KV`                                               | Provider-managed expiry and revocation                                   |
| Parsed training-day responses, dates, fetch timestamps and limits                                   | `CACHE_KV`, keyed by a hashed subject, day and read mode | Today: 5 minutes; yesterday: 2 minutes; other days are not written       |
| Public movement catalog                                                                             | `CACHE_KV`                                               | 7 days, subject to the KV write budget                                   |
| Training sessions, movement/set fields and derived metrics                                          | D1 (`DB`): `session`, `movement`, `set_fact`             | Persistent; no automatic expiry                                          |
| Scan dates, coverage, counts, fingerprints, retries/errors, index metadata and daily quota counters | D1: `scan_day`, `meta`, `scan_budget`, `kv_budget`       | Persistent; no automatic expiry                                          |
| Read-pacing and cooldown timestamps; keys include a hashed subject and training day                 | `UPSTREAM_GATE` Durable Object storage                   | No automatic expiry; updates replace the state for that key              |
| Scanner subject, freshness flag, start/progress state and alarm                                     | `SCAN_COORDINATOR` Durable Object storage                | Persistent; pausing cancels the alarm but retains state and the D1 queue |
| Request and application logs                                                                        | Cloudflare                                               | Operator's plan and retention settings                                   |

OAuth configuration sets access-token lifetime to one hour, refresh-token
absolute and idle limits to 30 days, and dynamic client registration lifetime
to 90 days. These settings do not expire D1 or Durable Object data.
The operator label may be derived from the email's local part, so OAuth state
should also be treated as personal data.

The D1 index contains record-level copies, including dates, session identifiers,
titles, movements, weights and repetitions, as well as aggregates. It is not
anonymous data. Subject hashes isolate the hot cache; D1 is a single-account
index shared by the deployment's authorized clients.

Xunji keys stay in Worker secrets, outside KV, D1 and OAuth props. Optional body
and nutrition adapters use separate secrets. Their responses are returned to
the requesting client; the adapters do not persist them in the training index
or hot cache.

## What is sent where

- The browser sends OAuth parameters and consent decisions to the Worker. In
  passphrase mode, it also sends the deployment passphrase.
- Cloudflare Access, when configured, authenticates the operator; the Worker
  fetches Access signing keys to verify that identity.
- For CIMD clients, the Worker fetches the client's metadata document to
  validate registration.
- The Worker sends requests and the matching vendor key to Xunji's official
  training, plan, body or food endpoints. Training writes are real operations
  and require the write opt-in, `xunji:write` and `confirmed: true`; there is no
  dry run or delete tool.
- The MCP client receives the requested records, aggregates and coverage
  metadata. Its own storage, conversation history and retention policies apply.

The consent page and optional MCP Apps view use self-contained assets, with no
analytics or third-party scripts/fonts. The Apps view displays the existing
overview result without extra data access. Real ChatGPT rendering remains
pending in the [verification record](docs/acceptance.md).

## Logs

MCP diagnostics report tool names and counts; authorization failures log error
names and messages. `/healthz` reports version/configuration status and an
allowlist count, not training records. Operator-only index status can include
coverage dates and counts, so it should not be pasted into a public issue.

Do not enable logging of request bodies, upstream payloads, credentials or
personal records. Cloudflare platform logs, including request metadata, follow
the operator's settings and must be reviewed separately.

## Your rights and controls

Revoke the OAuth grant to stop that client's bridge access. Removing a client
connection does not erase the D1 index, and rotating/revoking a Xunji key only
changes future upstream access. Existing indexed data and client copies remain.
Key rotation requires operator action and is still pending in the verification
record.

For a complete instance cleanup:

1. Stop scheduled refresh and pause the scanner, then revoke client grants.
2. Remove both KV namespaces and the D1 database, including scan metadata and
   quota tables, when those resources belong only to this instance.
3. Remove the stored instances and alarms of both Durable Object classes using
   Cloudflare's supported class-removal migration or storage lifecycle controls.
   Removing a binding or the Worker alone is not a complete storage cleanup.
4. Handle platform log/recovery retention, backups, exports and MCP-client
   copies under the relevant Cloudflare and client policies.

The bridge has no all-storage purge endpoint. Refreshing an indexed day updates
copies after source edits or removals; it does not delete anything in Xunji.
Correct a session with a `localid` upsert, or manage records in the Xunji app.

## Children and medical use

The bridge exposes recorded training data. It is not a medical device and does
not provide diagnosis or treatment advice. Tool descriptions tell agents to
avoid presenting the data as medical advice.

## Contact

Use [Support](SUPPORT.md) for general privacy questions. Report sensitive
disclosures through the private channel in [Security](SECURITY.md).
