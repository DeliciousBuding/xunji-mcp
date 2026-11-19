# ADR 0003 — Upstream contract, rate limits and write safety

- Status: accepted
- Date: 2026-11-19

## Context

The Xunji Open API is documented through the vendor's own Agent Skill and the
public `Xunji-movements` repository. Its observable behavior differs from a
conventional REST API in ways that must be encoded once, centrally.

Verified on 2026-11-19 against the operator's own account:

| Behavior         | Observation                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| Success envelope | `{ res: {...} }`; `success` is absent on reads.                                                               |
| Failure envelope | HTTP 200 with `{ success: false, res: "too frequent, retry after 30s" }` or `"apikey invalid"`.               |
| Compression      | gzip at the transfer layer for larger replies; small ones are plain.                                          |
| Rate limit       | Same key + same day: 15s light, 30s `include_full_data`. Different days are independent.                      |
| Limits block     | Returned in every train read (`limits.readRateLimitSecondsLight/Full`, write 45s).                            |
| Write `dry_run`  | **Ignored.** A request with `dry_run: true` created the record.                                               |
| Delete           | No endpoint documented or observed.                                                                           |
| Catalog          | `POST /api_movement_catalog_for_llm_v2` with `{}`; public, no key required.                                   |
| Plans            | `POST /open/plan/query_gzip` on `api.xunjiapp.cn`, same key, actions `list` and `get`.                        |
| Other domains    | Body and food/nutrition endpoints require **separate keys**; the training key is rejected (`apikey invalid`). |

## Decision

1. Treat the write endpoint as always-live. The bridge never sends `dry_run`
   and never presents a preview as safe. The only preview is a local
   confirmation step performed by the calling agent before invoking the tool.
2. Normalize once, in `src/domain/normalize.ts`. Tools never return raw
   upstream payloads; free-text notes are opt-in and attached calories/color
   are parsed into fields.
3. Compute volume from completed sets only, with bodyweight as zero load.
   Unchecked sets are preserved in returned data but never counted.
4. Centralize pacing in a Durable Object keyed by `(subjectHash, date, mode)`:
   reserve a slot, wait a bounded amount, or return `deferred` with a precise
   retry hint. A vendor soft rate-limit sets a cooldown visible to the next
   caller.
5. Cache normalized payloads per subject for 6h (past days), 60s (today) and
   15m (future). Writes invalidate the day by overwriting it with the server's
   standardized response.
6. Range tools cap at two uncached upstream reads per call and report
   `pending` dates. This keeps tool calls below common client timeouts and
   makes coverage explicit rather than silently partial.
7. Data domains other than training are not registered. Body and nutrition
   adapters would need their own keys and their own live verification; shipping
   them untested would violate the "no invented coverage" rule.

## Consequences

- A 31-day range needs several calls. That is a faithful representation of the
  vendor limit, not a bridge defect.
- The bridge can never claim "deleted". Documentation and tool descriptions say
  so explicitly.
- The write tool remains code-complete but unregistered by default; its tests
  mock the upstream and assert that no `dry_run` field is ever sent.
