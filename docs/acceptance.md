# Acceptance criteria and verification status

Status legend: **PASS** verified in this repository's own runs; **PARTIAL**
implemented and tested with mocks, not against live upstream; **BLOCKED**
requires an operator action; **N/A** out of scope.

| # | Criterion | How verified | Status |
|---|---|---|---|
| A1 | Reads a real training day through the operator's key | Live read of multiple dates; values only inspected as counts/aggregates | PASS |
| A2 | Handles gzip and plain upstream bodies | Unit + integration fixtures; live responses observed in both forms | PASS |
| A3 | Treats "no training recorded" as success | Integration test with an empty day | PASS |
| A4 | Maps `too frequent, retry after Ns` to a typed retryable result | Integration test with a stubbed vendor reply | PASS |
| A5 | Enforces per-day pacing and cooldowns | Durable Object tests + live observation of the 30s full-read limit | PASS |
| A6 | Bounded range reads, explicit `pending` | Implementation + tests for caps; live partial reads not exercised at full span | PARTIAL |
| A7 | OAuth discovery documents complete | Integration tests: PRM, AS metadata, S256, `iss` | PASS |
| A8 | PKCE code flow end-to-end | Integration test: register → authorize → token → `tools/list` | PASS |
| A9 | Wrong passphrase creates no grant | Integration test | PASS |
| A10 | Unregistered redirect URI refused | Integration test | PASS |
| A11 | Unauthenticated `/mcp` returns 401 with `resource_metadata` | Integration test | PASS |
| A12 | Write tools absent by default | Integration + unit tests | PASS |
| A13 | Write path never sends `dry_run` | Unit test asserting the serialized body | PASS |
| A14 | Write path refuses out-of-window dates and missing confirmation | Unit tests | PASS |
| A15 | No secrets or real data in the public tree | Secret scan + manual review + git history check | PASS |
| A16 | Typecheck, lint, unit, contract and integration tests in CI | `npm run typecheck && npm test` locally; workflow committed | PASS (local) |
| A17 | Deployed Worker on the production origin with TLS | `wrangler deploy` + 9/9 production smoke checks on 2026-11-19 | PASS |
| A18 | Real ChatGPT connection completes OAuth and lists tools | ChatGPT connector added, Access sign-in + consent, CIMD recognized; `tools/list` reached over the issued token | PASS |
| A19 | Real ChatGPT read call returns the operator's data | ChatGPT call returned 1 session / 5 movements / 17 completed sets for 2026-11-17, matching an independent read | PASS |
| A20 | Access-mode identity verified in production | Access app scoped to `/authorize`, JWT verified against team JWKS, email allowlist enforced | PASS |
| A21 | Xunji key rotated after exposure in chat | Operator action in the Xunji app | BLOCKED (operator) |
| A22 | Body/nutrition domains | Not registered; separate keys required | N/A |

## Definition of done for a release

1. `npm run typecheck` and `npm test` pass from a clean checkout.
2. `scripts/secret-scan.mjs` finds no credential patterns in tracked files.
3. `git log --all -p` contains no real key, token, email, host or training data.
4. Deployed `/healthz` reports `upstreamKey: true` and a non-`none` identity mode.
5. An unauthenticated `/mcp` request returns 401 with a `resource_metadata`
   challenge pointing at the deployment's canonical resource.
6. The operator has completed a real client connection and a read call; the
   report says so, or says it is still pending.

Criteria A17–A20 were executed on 2026-11-19 against a private deployment. The
public repository still does not claim compatibility for any particular hosted
workspace; each deployment must repeat the connection check.
