# Availability and verification

[English](coverage.md) · [简体中文](coverage.zh-CN.md)

This guide describes the generic tool surface and how to assess a deployment.
It contains no personal deployment settings or completed-history claims.
Availability, source-contract verification, indexed coverage and client
compatibility are separate checks.

## Tool availability

Every listed MCP tool requires `xunji:read`. Training tools also require `train`
in `ENABLED_DATA_DOMAINS`. Optional domains require their own domain entry and
matching independent secret.

| Domain / surface                                | Tool                                                                         | Registration or use requirements                                                                      | Verification boundary                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Capabilities                                    | `xunji_capabilities`                                                         | Read scope                                                                                            | Configuration summary, not a live probe                                              |
| Training day                                    | `xunji_get_training_day`                                                     | `train`; `XUNJI_API_KEY` needed to read upstream                                                      | Observed request/envelope contract; verify the operator's own key separately         |
| Indexed grouping                                | `xunji_query_training`                                                       | `train` + D1 `DB`                                                                                     | Reads existing indexed facts; full-window coverage requires scans                    |
| Indexed overview                                | `xunji_training_overview`                                                    | `train` + D1 `DB`                                                                                     | KPIs describe the reported window and coverage                                       |
| Movement progress                               | `xunji_movement_progress`                                                    | `train` + D1 `DB`                                                                                     | Derived estimates and plateau heuristic, not tested strength or a medical assessment |
| History controls                                | `xunji_history`                                                              | `train` + D1 `DB` + `SCAN_COORDINATOR`; training key needed for scanning                              | Acceptance means work was queued, not completed                                      |
| Bounded day/range statistics                    | `xunji_list_training_days`, `xunji_training_stats`, `xunji_movement_history` | `train`; training key needed for upstream reads                                                       | Partial calls expose `pending` and `deferred`; they do not read D1                   |
| Movement catalog                                | `xunji_search_movements`                                                     | `train`; no upstream training key required                                                            | Public catalog contract; names and size can change                                   |
| Official plans                                  | `xunji_list_plans`, `xunji_get_plan`                                         | `train`; training key needed for upstream reads                                                       | List/get envelopes observed; populated day schedules and plan comparison unverified  |
| Body measurements                               | `xunji_body_query`                                                           | `body` + `XUNJI_BODY_KEY`                                                                             | Adapter from the vendor skill; not live-verified                                     |
| Food records                                    | `xunji_nutrition_query`                                                      | `nutrition` + `XUNJI_FOOD_KEY`                                                                        | Adapter from the vendor skill; not live-verified                                     |
| Food search                                     | `xunji_search_foods`                                                         | `nutrition` + `XUNJI_FOOD_SEARCH_KEY`                                                                 | Adapter from the vendor skill; not live-verified                                     |
| Training upsert                                 | `xunji_upsert_training_day`                                                  | `train` + `WRITE_TOOLS_ENABLED=true` + `xunji:write`; training key needed; `confirmed: true` per call | Real write, off by default; no safe upstream preview or delete                       |
| MCP Apps overview                               | Resource `ui://xunji/overview`                                               | `train` + D1 + `MCP_UI_ENABLED=true` + read scope                                                     | Registration and host rendering must be checked separately                           |
| Templates, plan writes, plan comparison, delete | No tool                                                                      | Outside the implemented surface                                                                       | No availability or completion claim                                                  |

## Interpreting `xunji_capabilities`

The tool returns rows from [the capability matrix](../src/capabilities.ts)
with `domain`, `capability`, `endpoint`, `tool`, `scope`, `configured`,
`verified`, `status` and optional notes. Its status values are `ready`,
`unconfigured`, `disabled` and `not_implemented`.

These fields currently describe source constants and environment bindings:

- `configured` generally checks key/binding presence, not credential validity.
  The write row checks only the enable flag.
- `verified` is a code-level marker. Training/catalog/plan rows use constants;
  indexed rows use binding presence. It does not perform a request or record
  a deployment's live validation. Body/nutrition/write rows remain `false`.
- The matrix does not apply `ENABLED_DATA_DOMAINS` or the caller's scope to
  every row. Indexed rows require both D1 and the scanner in the matrix, while
  query-tool registration needs D1 only.
- Consequently, a `ready` row is not proof that the caller can discover or
  execute that tool. Use OAuth `tools/list` for the actual token-specific
  inventory, then a read-only call for credential and response validation.

The public `/healthz` endpoint reports configuration flags, identity mode,
version and an allowlist-entry count. It does not validate secrets, schema
migrations, the upstream account or client connectivity.
`GET /admin/tools`, protected by `ADMIN_TOKEN`, lists tools and resources with
a read-only synthetic admin identity; it does not check write-scope discovery.

## Indexed coverage

Each requested calendar day has a scan state:

| State      | Meaning                                                                                 |
| ---------- | --------------------------------------------------------------------------------------- |
| `complete` | A successful read contained sessions and the index replacement finished                 |
| `empty`    | A successful read contained no sessions                                                 |
| `pending`  | Queued or deferred work; a day with no queue row is also counted as pending in coverage |
| `error`    | A read or replacement failed and has a retry time                                       |

`coverage.complete` is true only when every requested day is `complete` or
`empty` and there are no error days. It establishes scan coverage, not a
complete full-mode upstream payload. Scans use light reads, and upstream
truncation is not a separate scan state.

Use the full `coverage` block: bounds, `days`, `scannedDays`, `emptyDays`,
`pendingDays`, `errorDays`, `latestScanned` and `lastRefresh`. Returned
`pending` and `errors` arrays are capped at 60 and 20 entries respectively;
their counts can be larger. `missingDays` includes both queued and absent
nonterminal days.

`earliestRecord` means the earliest indexed session in the relevant window.
It establishes nothing about earlier account history. Field names need care:
`coverage.earliestVerified` is the earliest terminal scan date, while
`xunji_history.history.earliestVerified` currently contains the end of the
contiguous terminal prefix from the configured start. Neither replaces the
per-window completeness check.

An accepted backfill, a nonzero queue or `scanner.running: true` does not prove
that an alarm is executing. The running flag and ETA are computed from pause
state, queue counts and average progress. Budget waits and retries can change
the completion time.

## Freshness and current implementation limits

- The legacy two-read budget counts successful uncached results. Deferred
  results do not consume it, so it does not cap every attempted upstream request.
- The daily cron fills only the tail after the latest terminal scan date
  through yesterday. Use `refresh` to revisit older source edits or gaps.
- On-demand day reads and upserts do not update D1. An upsert may refresh an
  eligible light KV entry; the full KV entry and indexed facts remain separate.
- Day replacement uses several D1 batches and then records scan status.
  There is no transaction spanning the entire day. A failed refresh can leave
  a partially replaced day, with incomplete coverage.
- KV write accounting is a cache-attempt budget. It excludes provider-owned
  OAuth writes. Although the cache layer tracks degradation, current day
  tools do not forward that flag into their metadata.
- Indexed volume uses numeric recorded weight and reps in kg, with missing
  units treated as kg. `selfWeight` is counted separately but does not override
  an explicit numeric weight. Best-weight and Epley fields assume recorded
  weights are kg; they do not convert units.
- Use either a range preset or explicit dates. Rolling presets currently
  ignore an explicit `from`; omit `preset` for a custom window.
- Body `latest` parsing and optional-domain pagination have not been validated
  against live responses. Enabling a key does not establish complete retrieval.

These limits are documented behavior, not a report that a deployment was
tested or that the gaps were fixed.

## Verification without publishing account data

Repository checks use synthetic fixtures and stubbed upstream HTTP. The
release criteria are maintained in [acceptance](acceptance.md); passing those
checks does not verify another deployment.

For a deployment, check OAuth discovery and the unauthenticated challenge,
complete operator consent, inspect `tools/list`, and make a read-only call.
For indexed analysis, inspect history status and the coverage of the exact
requested window. For MCP Apps, separately confirm the resource link and
rendering in the selected host.

Keep domain names, keys, email addresses, account identifiers, dates and
training values in a private operator record. Public verification notes should
state the method and unresolved capability only. See the
[deployment guide](deployment.md), [ChatGPT connection guide](chatgpt-connect.md)
and [upstream contract notes](api-contract.md).
