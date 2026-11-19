# Tools

All tools return JSON in `content[0].text` and in `structuredContent`. Failures
set `isError: true` and a stable `error.code`. Dates are `YYYY-MM-DD` calendar
days exactly as Xunji stores them; the bridge does not reinterpret time zones.

## `xunji_capabilities`

No arguments. Returns enabled data domains, whether write tools are registered
for this token, coverage limits and the vendor pacing this bridge respects.
Call it first when unsure what a deployment exposes.

## `xunji_get_training_day`

| Argument | Type | Default |
|---|---|---|
| `date` | `YYYY-MM-DD` | required |
| `detail` | `"summary" \| "full"` | `summary` |
| `includeNotes` | boolean | `false` |
| `refresh` | boolean | `false` |

`summary` keeps only completed sets. `full` uses the vendor's
`include_full_data` mode (unchecked sets, RPE, notes, heart-rate summaries) and
is paced at 30 seconds per day. `includeNotes` adds the session note text and
parsed calories/color.

Returns `status: "recorded"` with normalized trains and totals, or
`status: "no_training"` with empty arrays. A rate-limited read returns
`status: "deferred"` plus `retryAfterSeconds` and `isError: true`.

## `xunji_list_training_days`

| Argument | Type | Default |
|---|---|---|
| `from` | `YYYY-MM-DD` | required |
| `to` | `YYYY-MM-DD` | required |

One row per day with `trainCount`, `movementCount`, `completedSetCount`,
`totalVolumeKg`, `durationMinutes`, `hasHeartRate`, `localids`, `truncated`.
Maximum 31 days. At most two uncached upstream reads per call; dates beyond the
budget are listed in `pending`, and busy days appear in `deferred`.

## `xunji_movement_history`

| Argument | Type | Default |
|---|---|---|
| `movements` | string[] (1–8) | required |
| `from` / `to` | `YYYY-MM-DD` | required |

Exact canonical names. Returns one row per occurrence with completed sets,
top-set weight, total reps and volume. Maximum 62 days. `missingMovements`
names inputs with no occurrence in the covered days — use
`xunji_search_movements` if the spelling may be wrong.

## `xunji_training_stats`

| Argument | Type | Default |
|---|---|---|
| `from` / `to` | `YYYY-MM-DD` | required |

Aggregates: `daysWithTraining`, `trainCount`, `movementCount`,
`completedSetCount`, `totalVolumeKg`, total and average session duration,
`byWeekday`, `topMovements` (by completed sets, then volume) and `titles`.
Maximum 31 days, two uncached reads.

Volume counts completed sets only; bodyweight sets contribute zero load, not an
estimate. This is arithmetic on recorded values, not a physiological model.

## `xunji_search_movements`

| Argument | Type | Default |
|---|---|---|
| `query` | string (1–40) | required |
| `limit` | 1–50 | `20` |

Substring match over the public catalog (~1,200 names), including aliases.
Cached for 7 days. Use it before any write so the vendor's name matching
succeeds.

## `xunji_list_plans` / `xunji_get_plan`

List official plans, then read one by `planRef` (`platform:<id>` or
`universal:<id>`). `get` defaults to seven days back through 30 days forward
and refuses spans over 92 days. Read-only: the bridge never mutates a schedule.

## `xunji_upsert_training_day` (opt-in write)

Registered only when `WRITE_TOOLS_ENABLED=true` **and** the token has
`xunji:write`.

| Argument | Notes |
|---|---|
| `date` | must be within ±6 months |
| `confirmed` | must be the literal `true` |
| `clientRequestId` | 8–128 chars; reuse on retry |
| `localid` | update this session; omit to create |
| `title` | optional |
| `movements` | 1–15; each 1–20 sets |

The vendor ignores `dry_run`, so this tool never sends it and is a real write
the moment it is called. It cannot delete. Existing sessions are only touched
when `localid` is supplied. Responses replace the cached day with the server's
standardized payload.

## Error codes

| Code | Meaning |
|---|---|
| `rate_limited` | Vendor pacing; retry after `retryAfterSeconds` |
| `unauthorized` | Vendor rejected the deployment's key |
| `vip_required` | Xunji account lacks the required membership |
| `invalid_request` | Vendor rejected parameters |
| `upstream_unavailable` | Network, timeout or unknown vendor failure |
| `bad_payload` | Non-JSON or oversized vendor body |
| `not_configured` | No `XUNJI_API_KEY` in this deployment |
| `range_too_large` / `invalid_range` | Tool window violated |
| `confirmation_required` | Write called without `confirmed: true` |
| `date_out_of_range` | Write outside the six-month window |
| `internal_error` | Unexpected bridge failure |
