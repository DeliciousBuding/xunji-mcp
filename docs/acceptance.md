# Acceptance criteria and verification status

[English](acceptance.md) | [简体中文](acceptance.zh-CN.md)

The table records verification inherited from earlier releases. Current
release checks are recorded separately below; they do not repeat the historical
private-client checks. Personal records, aggregates, date ranges and deployment
identifiers are omitted.

Status legend: **PASS** records earlier verification within the stated scope;
**PARTIAL** records implementation/mock coverage without full live verification;
**BLOCKED** requires operator or client action; **N/A** is outside that release's
scope. A historical PASS is not an attestation of a current deployment or every
client.

| #   | Criterion                                                          | Historical verification scope                                                                                | Status             |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------ |
| A1  | Read a training day through the operator's key                     | Earlier private upstream reads; content omitted                                                              | PASS               |
| A2  | Handle gzip and plain upstream bodies                              | Fixture tests and earlier observation of both response forms                                                 | PASS               |
| A3  | Treat an empty training day as success                             | Earlier integration test with an empty-day stub                                                              | PASS               |
| A4  | Map `too frequent, retry after Ns` to a typed retryable result     | Earlier integration test with a stubbed vendor reply                                                         | PASS               |
| A5  | Enforce per-day pacing and cooldowns                               | Earlier Durable Object tests and private observation of full-read pacing                                     | PASS               |
| A6  | Bound range reads and return explicit `pending`                    | Cap tests recorded; full-span live partial reads were not exercised                                          | PARTIAL            |
| A7  | Publish OAuth discovery documents                                  | Earlier integration tests for PRM, AS metadata, S256 and `iss`                                               | PASS               |
| A8  | Complete the PKCE code flow                                        | Earlier register → authorize → token → `tools/list` integration test                                         | PASS               |
| A9  | Refuse a wrong passphrase without creating a grant                 | Earlier integration test                                                                                     | PASS               |
| A10 | Refuse an unregistered redirect URI                                | Earlier integration test                                                                                     | PASS               |
| A11 | Challenge unauthenticated `/mcp` with 401 and `resource_metadata`  | Earlier integration test                                                                                     | PASS               |
| A12 | Omit write tools by default                                        | Earlier integration and unit tests                                                                           | PASS               |
| A13 | Never send `dry_run` on the write path                             | Earlier unit test of the serialized request body                                                             | PASS               |
| A14 | Refuse out-of-window writes and missing confirmation               | Earlier unit tests                                                                                           | PASS               |
| A15 | Record publication secret-pattern checks                           | Earlier scanner, manual review and history checks; these do not prove absence of every kind of personal data | PASS               |
| A16 | Run local typecheck/tests and include a CI workflow                | Earlier `npm run typecheck && npm test`; workflow committed, without a blanket claim that CI/lint ran        | PASS (local)       |
| A17 | Deploy a Worker with TLS                                           | Earlier private deployment and production smoke checks                                                       | PASS               |
| A18 | Complete ChatGPT OAuth and list tools                              | Earlier Access sign-in, consent, CIMD and OAuth-authorized `tools/list`                                      | PASS               |
| A19 | Read training data through ChatGPT                                 | Earlier client read matched an independent read; content omitted                                             | PASS               |
| A20 | Verify Access-mode identity                                        | Earlier private JWT/JWKS and email-allowlist checks on `/authorize`                                          | PASS               |
| A21 | Confirm vendor-key rotation                                        | Operator action and confirmation in Xunji are still required                                                 | BLOCKED (operator) |
| A22 | Body, nutrition and food-search domains                            | Adapters use vendor skill contracts and separate keys; mock coverage recorded, no live upstream verification | PARTIAL            |
| A23 | Keep historical reads and scans out of KV writes                   | Earlier integration scan and private refresh checks                                                          | PASS               |
| A24 | Bound scan work by a daily budget                                  | Earlier backfill and exposed per-UTC-day budget counters                                                     | PASS               |
| A25 | Bound hot-cache KV writes by the deployment budget                 | Earlier over-budget skip behaviour with `budgetDegraded`                                                     | PASS               |
| A26 | Cover a configured historical index window                         | Earlier private backfill reported complete coverage for its configured window; dates/counts omitted          | PASS               |
| A27 | Return an indexed overview in one tool call                        | Existing synthetic benchmark artifacts; see [Benchmark](benchmark.md) for measurements and limitations       | PASS               |
| A28 | Reflect source edits/removals after refresh                        | Earlier integration test replaced an indexed day after source records were removed                           | PASS               |
| A29 | Distinguish empty, unscanned, pending and error coverage           | Earlier pending/error/partial integration tests and history status                                           | PASS               |
| A30 | Handle warmups, bodyweight, unilateral work and duration anomalies | Earlier integration tests of exclusions, counting and anomaly flags                                          | PASS               |
| A31 | Call a v0.2 query tool through ChatGPT                             | Earlier OAuth-authorized `xunji_training_overview all_time` call returned an indexed result; content omitted | PASS               |
| A32 | Remove the alternate `workers.dev` entry point                     | Earlier private route check showed the alternate route unavailable while Access protected `/authorize`       | PASS               |
| A33 | Remove the deployed passphrase fallback after Access works         | Earlier private secret listing and authorization checks                                                      | PASS               |
| A34 | Refresh the index tail without client traffic                      | Earlier `enqueueDailyGap` tests and scheduled-trigger deployment; no deployment ID retained here             | PASS               |
| A35 | Register the MCP Apps view only when enabled                       | Earlier disabled/enabled resource and metadata tests, plus an operator tool-list check                       | PASS               |
| A36 | Render the MCP Apps view in ChatGPT                                | Existing record leaves real client rendering pending; resource registration alone is insufficient            | BLOCKED (client)   |

Training writes always mean real writes: opt-in deployment configuration,
`xunji:write` and `confirmed: true` are required. No `dry_run` is sent, and no
delete tool is exposed. Read-only live checks do not verify a real write.

Optional adapters remain `verified: false`. Configuration or mock coverage
must not be described as live verification. Key rotation and ChatGPT MCP Apps
rendering remain operator/client pending respectively.

## v0.3.1 repository and website checks

The current publication adds checks for the site and bilingual documentation:

| Check                   | Result and scope                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Types, lint, formatting | `npm run typecheck`, `npm run lint`, `npm run format:check`                                                                                   |
| workerd                 | 68 tests across 11 files, with stubbed upstream HTTP                                                                                          |
| Dependency audit        | `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities                                                                                  |
| Worker bundle           | `wrangler deploy --dry-run --config wrangler.example.jsonc`: public example only                                                              |
| Site build              | English and Chinese static output, local CSS/JS/images, no upstream access                                                                    |
| Browser behavior        | 10 Edge cases across both locales and 320/390/768/1024/1440px; no horizontal overflow, broken images or script errors; tabs and FAQ exercised |
| Documentation           | 59 Markdown files, 364 local references, no missing translation counterpart                                                                   |
| Banner exports          | README 2560×1280; social preview 1280×640; both 2:1 PNG                                                                                       |

The credential scanner passes on the working tree and reachable Git history.
It checks credential patterns, not arbitrary personal data. The current public
documents omit private statistics; older published Git objects still retain
some prior verification aggregates. Removing those objects requires a separate
history cleanup.

These checks do not re-run private account reads, verify body/nutrition, or
establish ChatGPT MCP Apps rendering.

## Definition of done for a release

Apply this checklist to the scope of each release.

1. Run the applicable typecheck, lint, formatting and workerd tests; use upstream
   stubs and report the exact commands/results.
2. Run `node scripts/secret-scan.mjs --history` and review public files, fixtures,
   screenshots and history for personal data beyond credential patterns.
3. Synchronize affected English/Chinese docs and describe the tagged source in
   the release body.
4. For an authorized deployment, check `/healthz`, canonical OAuth discovery
   and the unauthenticated `/mcp` challenge; keep private identifiers out of the
   public report.
5. Record a real client connection and a read call for that deployment/client,
   or explicitly leave them pending. If UI support is claimed, verify actual
   client rendering separately from resource registration.
6. Keep operator key rotation and any unverified optional domains visible until
   those actions are confirmed.

The earlier private-deployment checks do not establish compatibility for any
particular hosted workspace. Each operator must repeat the relevant connection
check for their own deployment. See [Privacy](../PRIVACY.md) for persistent
storage and cleanup.
