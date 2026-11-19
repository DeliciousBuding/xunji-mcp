# ADR 0003 — Upstream contract, rate limits and write safety

[English](0003-upstream-contract-and-write-safety.md) · [简体中文](0003-upstream-contract-and-write-safety.zh-CN.md)

- Status: accepted
- Date: 2026-11-19

## Context

The Xunji Open API is documented through the vendor's own Agent Skill and the
public `Xunji-movements` repository. Its observable behavior differs from a
conventional REST API in ways that must be encoded once, centrally.

Previously observed upstream behavior, recorded without account values:

| Behavior         | Observation                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| Success envelope | `{ res: {...} }`; `success` is absent on reads.                                                               |
| Failure envelope | HTTP 200 with `{ success: false, res: "too frequent, retry after 30s" }` or `"apikey invalid"`.               |
| Compression      | gzip at the transfer layer for larger replies; small ones are plain.                                          |
| Rate limit       | Same key + same day: 15s light, 30s `include_full_data`. Different days are independent.                      |
| Limits block     | Returned in every train read (`limits.readRateLimitSecondsLight/Full`, write 45s).                            |
| Write `dry_run`  | Ignored; a request carrying the flag can still write.                                                         |
| Delete           | No endpoint documented or observed.                                                                           |
| Catalog          | `POST /api_movement_catalog_for_llm_v2` with `{}`; answered without a valid key.                              |
| Plans            | `POST /open/plan/query_gzip` on `api.xunjiapp.cn`, same key, actions `list` and `get`.                        |
| Other domains    | Body and food/nutrition endpoints require **separate keys**; the training key is rejected (`apikey invalid`). |

## Decision

1. Treat the write endpoint as always live. Register the tool only with enabled
   training, read scope, `WRITE_TOOLS_ENABLED=true` and write scope. Require
   `confirmed: true` and a date within the implemented 190-day guard. The
   agent must show the exact change for confirmation before calling it.
   No `dry_run` field or delete tool is provided.
2. Centralize envelopes, compression and typed failures in
   `src/upstream/client.ts`. Normalize training output in
   `src/domain/normalize.ts`; D1 facts and query metrics use the index/metrics
   modules. Selected plan values stay opaque.
3. Indexed queries select completed sets, exclude warmups by default, do not
   double unilateral weights and bound Epley estimates to 1–12 reps.
   Current arithmetic uses numeric recorded weight: `selfWeight` does not
   override an explicit load. Legacy normalization has different warmup/reps
   behavior. These limits are explicit in [tools](../tools.md).
4. Reserve pacing in a Durable Object keyed by `(subjectHash, date, mode)`.
   Bounded waits become `deferred`; vendor soft rate limits store cooldowns.
   These entries are not a global gate for all callers of the same upstream key.
5. Cache unwrapped vendor day responses per subject and mode for five minutes
   today and two minutes yesterday. Other dates are not written to the day
   cache. Catalog caching lasts seven days. All cache puts use a D1 budget;
   scans skip KV entirely.
6. Keep legacy ranges bounded to 31/62 days and at most two successful uncached
   reads per call, with `pending`/`deferred`. Historical calls have no
   persistent cursor; use narrower pending ranges or indexed queries.
7. Use D1 plus a resumable scan coordinator for history. Queries report
   `complete`/`empty`/`pending`/`error` coverage. Refresh replaces source facts
   in batches and then records scan status; the whole day is not atomic.
   The cron fills the uncovered tail through yesterday, not old edits.
8. Optional body/nutrition tools need independent secrets and enabled domains.
   Their adapters come from vendor skills and remain marked `verified: false`;
   no live success or complete retrieval is inferred from configuration.

## Consequences

- A legacy range can be partial. Repeating the same historical window does not
  accumulate coverage through KV; an indexed backfill is the history path.
- The bridge can never claim "deleted". Documentation and tool descriptions say
  so explicitly.
- The write adapter exists but defaults off. A nonempty response may replace an
  eligible light cache entry, but does not update D1 or invalidate full entries.
  Read back the change and refresh derived facts separately.
- Session `noteText` is opt-in; movement/set note fields and parsed
  calories/color may still appear. Clients must treat all returned text as data.
- Repository checks must use synthetic fixtures and stubbed upstream HTTP.
  Live verification is a separate operator activity and belongs in private
  records; enabling writes is not a verification shortcut.
- `coverage.complete` establishes terminal scan coverage, not an untruncated
  full upstream payload. A failed replacement can leave partial facts.

See [upstream contracts](../api-contract.md), [coverage](../coverage.md) and
[the threat model](../threat-model.md) for the current verification boundaries.
