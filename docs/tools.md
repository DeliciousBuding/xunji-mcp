# Tools

[English](tools.md) · [简体中文](tools.zh-CN.md)

Dates are `YYYY-MM-DD` calendar days as stored by Xunji. Defaults use
`Asia/Shanghai`; budget counters use UTC. The server exposes tools according
to domain flags, bindings and OAuth scope. See [availability](coverage.md) for
registration conditions; key presence alone does not prove upstream access.

Analytic tools put data in `structuredContent` and a short summary in
`content[0].text`. Legacy day tools and several history-control responses
serialize JSON in both fields. Errors normally set `isError: true` and
`error.code`. A deferred day read instead returns `status: "deferred"`,
`reason` and `retryAfterSeconds` with `isError: true`. Partial range/index
results can succeed: inspect `pending`, `deferred` or `coverage`.

## Shared indexed range

`xunji_query_training`, `xunji_training_overview` and
`xunji_movement_progress` accept an optional `range` object:

| Field         | Values                                                            |
| ------------- | ----------------------------------------------------------------- |
| `preset`      | `all_time`, `last_7d`, `last_30d`, `last_90d`, `last_365d`, `ytd` |
| `from` / `to` | Optional `YYYY-MM-DD` bounds                                      |

Omitting the object defaults to `all_time`. Its start is the stored
`history_start`, then the earliest terminal scan date, then 365 days before
the default end. `HISTORY_START_DATE` is a scanner default; it is not read
directly by the query range resolver. Explicit dates with no preset form a
custom window.

Use either a preset or explicit dates. Rolling presets currently ignore an
explicit `from`. All indexed query windows are capped at 7320 days.
Query/overview default to yesterday unless `includeToday: true`;
movement progress defaults its end to today. Including today only reads facts
already indexed; it does not trigger an upstream fetch.

## `xunji_capabilities`

No arguments. Returns endpoint rows (`domain`, `capability`, `endpoint`,
`tool`, `scope`, `configured`, `verified`, `status`, optional notes), token
scopes, write availability, index counters and query/pacing limits.

It performs no upstream verification. `verified` is currently a source marker
or binding check; `configured` generally checks presence. Domain flags and
token scopes are not applied to every matrix row. Use `tools/list` to determine
the actual tools available to this token.

## `xunji_query_training`

One declarative query over existing D1 facts.

| Argument         | Type / bounds                                                       | Default                       |
| ---------------- | ------------------------------------------------------------------- | ----------------------------- |
| `range`          | Shared indexed range                                                | `all_time`                    |
| `movements`      | Exact names, at most 20                                             | All                           |
| `muscleGroups`   | Vendor `type` values, at most 8                                     | All                           |
| `groupBy`        | `total`, `day`, `week`, `month`, `year`, `movement`, `muscle_group` | `month`                       |
| `fields`         | At most 9 supported metric keys                                     | Group-dependent               |
| `includeWarmups` | Boolean                                                             | `false`                       |
| `includeToday`   | Boolean                                                             | `false`                       |
| `topK`           | Integer 1–50, ranked groups                                         | `12`                          |
| `orderBy`        | `volume_kg`, `sets`, `reps`, `est_1rm_kg`, `sessions`               | `volume_kg` for ranked groups |
| `limit`          | Integer 1–400, time-series rows                                     | `120`                         |
| `includeSets`    | Boolean; up to 400 drill-down rows                                  | `false`                       |

Metric keys are `sessions`, `training_days`, `sets`, `reps`, `volume_kg`,
`duration_min`, `best_weight_kg`, `est_1rm_kg` and `bodyweight_sets`.
`duration_min` is rejected for movement or muscle-group grouping.
Weeks start on Monday.

The result includes `query`, `range`, `columns`, `rows`, `rowCount`,
`truncated`, `omittedRows`, `totals`, `units`, `definitions`, `coverage`,
`unmatchedMovements`, `source` and `meta.generatedAt`.
Time-series limits retain the most recent buckets. Ranked groups use `topK`;
totals still cover the full filtered range. `includeSets` adds `setColumns`,
`setRows` and `meta.setsReturned`, ordered newest first.

Indexed metrics select completed sets. Warmups (`setType` containing `热`)
are excluded unless requested. Session counts require a matching set.
Volume sums numeric weight × reps for kg or missing units; missing values
and other units contribute no volume. Unilateral sets are not doubled.
`selfWeight` is reported separately and does not override an explicit weight.
Best-weight and Epley values use numeric recorded weights without conversion.
Epley uses `weight × (1 + reps / 30)` for positive weight and 1–12 reps.
Durations use session `start`/`end`; values below one minute or above six hours
are flagged and excluded from duration aggregation and averages.

Example using only generic preset values:

```json
{
  "range": { "preset": "last_30d" },
  "groupBy": "week",
  "fields": ["sessions", "sets", "volume_kg"],
  "includeToday": false
}
```

## `xunji_training_overview`

| Argument       | Type                 | Default    |
| -------------- | -------------------- | ---------- |
| `range`        | Shared indexed range | `all_time` |
| `includeToday` | Boolean              | `false`    |

Returns `kpis` (sessions, training days, sets, volume, duration hours, average
session minutes, duration anomalies and bodyweight sets), `monthly`,
`topMovements`, `recent`, range, source metadata and coverage.
The monthly series retains up to 12 buckets; the ranked list has up to eight
movements. `recent` compares the last four weeks ending at the selected end
with the preceding four weeks; those subwindows can extend before the selected
start. A zero previous volume produces a null percentage change.

This is indexed arithmetic. Incomplete coverage must accompany any conclusion
about the requested period.

## Optional MCP Apps view

With D1, enabled training, read scope and `MCP_UI_ENABLED=true`, the server
registers `ui://xunji/overview` (`text/html;profile=mcp-app`). The overview tool
links it using `_meta.ui.resourceUri` and `openai/outputTemplate`.

The current view has Simplified Chinese labels and renders the existing
structured result as KPIs and a monthly volume chart. It receives tool results
and theme context through host messages. It makes no network requests,
stores no data and invokes no tools. The resource is absent when disabled.
Tool execution and rendering in a host are separate compatibility checks;
text/structured results remain available without the view.

## `xunji_movement_progress`

| Argument    | Type / bounds                                    | Default    |
| ----------- | ------------------------------------------------ | ---------- |
| `movements` | 1–8 exact names                                  | Required   |
| `range`     | Shared indexed range; default end includes today | `all_time` |
| `maxPrRows` | Integer 1–20 per movement                        | `12`       |

Returns best recorded weight/reps/date, best Epley estimate, PR count and
timeline, monthly volume, session/date bounds, missing movements and coverage.
The timeline records increases in the running Epley best and retains up to
`maxPrRows`; `prCount` can be larger.

The plateau flag requires at least ten sessions with valid Epley estimates.
It compares the best of the last five with the previous five and flags an
increase of at most 1% when the last five span at least 28 days. This is a
heuristic. Estimated 1RM is a trend indicator, not a tested maximum.

## `xunji_history`

| Argument        | Type                                                         | Default                                    |
| --------------- | ------------------------------------------------------------ | ------------------------------------------ |
| `action`        | `status`, `backfill`, `extend`, `refresh`, `pause`, `resume` | `status`                                   |
| `start` / `end` | Optional calendar dates                                      | Stored/discovered start; yesterday for end |

`start` falls back to the stored history start, `HISTORY_START_DATE`,
the earliest indexed session, then 365 days before the end. Enqueue requests
are capped at 7320 days.

- `status` returns configured start, indexed bounds, per-window coverage,
  queue counts, pause state, budget counters, average scan rate and an ETA.
- `backfill` inserts days that have no scan row and starts the background loop.
- `extend` requires a start earlier than the stored history start.
- `refresh` requeues a range, rereads it and replaces indexed facts, including
  records removed in the Xunji app.
- `pause` / `resume` control the persistent scanner state and alarm.

These operations mutate the local index/queue under read scope; they do not
write training records upstream. `status: "accepted"` confirms queue setup,
not completion. The daily cron fills the tail through yesterday after a history
start is set. Manual requests can include today; the cron does not revisit
older edited days or gaps.

Check `coverage.complete` for the requested window. Pending/error lists are
bounded, and ETA/running are computed indicators. The field
`history.earliestVerified` currently holds the end of the contiguous scanned
prefix; `coverage.earliestVerified` holds the earliest terminal date.
See [coverage](coverage.md) for their interpretation and the batched
replacement limitation.

## `xunji_get_training_day`

| Argument       | Type              | Default   |
| -------------- | ----------------- | --------- |
| `date`         | `YYYY-MM-DD`      | Required  |
| `detail`       | `summary`, `full` | `summary` |
| `includeNotes` | Boolean           | `false`   |
| `refresh`      | Boolean           | `false`   |

`summary` requests a light payload and removes unchecked top-level sets from
the returned movements. `full` requests the vendor's full mode, with 30-second
pacing. Heart-rate output is a selected aggregate, not the raw compressed
series.

`includeNotes` controls session `noteText`. Parsed calories/color and
movement/set note fields can still appear when supplied by the source; it is
not a general redaction switch.

Returns `status: "recorded"` with normalized sessions and totals, or
`status: "no_training"` with empty arrays. `refresh` bypasses the hot day cache.
It neither reads nor refreshes D1. A deferred read supplies the retry time.

Legacy normalization differs from indexed working-set metrics: it includes
completed warmups in volume and may include unchecked reps in movement
`totalReps`. Use the indexed tools for working-set analysis.

## Bounded legacy range tools

Every call budgets at most two successful uncached day reads and returns
`pending` dates plus `deferred` retry hints. The counter does not include
deferred results, so it does not cap all attempted upstream requests.
These tools use the day-read path,
not D1. Historical dates are not retained in the hot cache, so repeating the
identical range is not pagination. Narrow the next request to pending dates,
or backfill and query the index.

### `xunji_list_training_days`

| Argument      | Type                                                                | Default  |
| ------------- | ------------------------------------------------------------------- | -------- |
| `from` / `to` | Calendar dates; 1–31 days inclusive                                 | Required |
| `refresh`     | Boolean, declared in the schema but currently unused by the handler | `false`  |

Returns one summary row per successfully read day: counts, volume, duration,
heart-rate presence, session `localids`, truncation and an optional title.
The result also has `daysRequested`, `daysRecorded`, `pending` and `deferred`.

### `xunji_movement_history`

| Argument      | Type / bounds                       | Default  |
| ------------- | ----------------------------------- | -------- |
| `movements`   | 1–8 exact canonical names           | Required |
| `from` / `to` | Calendar dates; 1–62 days inclusive | Required |

Returns movement occurrences with completed sets, top weight, reps and volume.
`missingMovements` means no match in the days read so far; it does not prove
absence in pending days. Use catalog search to resolve names.

### `xunji_training_stats`

| Argument      | Type                                | Default  |
| ------------- | ----------------------------------- | -------- |
| `from` / `to` | Calendar dates; 1–31 days inclusive | Required |

Returns counts, total volume, total/average duration, `byWeekday`,
`topMovements` and `titles` under `stats`. The stats bounds and
`stats.daysRequested` describe the successfully read days, not every requested
date. Results are partial when `pending` or `deferred` is nonempty.

## `xunji_search_movements`

| Argument | Type / bounds           | Default  |
| -------- | ----------------------- | -------- |
| `query`  | String, 1–40 characters | Required |
| `limit`  | Integer 1–50            | `20`     |

Substring search over public canonical names and aliases. Returns `matches`,
`matchCount`, `catalogSize` and metadata. Catalog writes use the shared
seven-day cache and cache budget. No training key is sent upstream.

## `xunji_list_plans` / `xunji_get_plan`

List has no arguments and returns `plans` and `planCount`.

| Get argument       | Type                                | Default              |
| ------------------ | ----------------------------------- | -------------------- |
| `planRef`          | Reference returned by list          | Required             |
| `from` / `to`      | Calendar dates; 1–92 days inclusive | Today −7 / today +30 |
| `includeMovements` | Boolean                             | `true`               |

Get returns `plan`, `days`, `dateRange`, selected bounds and metadata.
These nested plan fields remain opaque. A populated per-day schedule contract
has not been verified; plan comparison and schedule writes are not implemented.

## Optional body and nutrition tools

These adapters require independent domain keys and enabled domains, and always
return `verified: false`. Their live contracts and retrieval completeness
remain unverified; see [upstream notes](api-contract.md).

| Tool                    | Arguments                                                                                                 | Current output                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `xunji_body_query`      | Required `from`/`to`; optional `types` (≤15), `includeLatest=true`, `limit=500` (1–1000), `offset=0` (≥0) | `records`, attempted `latest`, `retrieved` |
| `xunji_nutrition_query` | Required `from`/`to`; `includeDetail=true`                                                                | Normalized food `records`, `retrieved`     |
| `xunji_search_foods`    | `keyword` (1–40 characters), `limit=8` (1–20)                                                             | `foods`, source candidate `count`          |

Body types preserve vendor spellings: `weight`, `bodyfat`, `neck`, `chest`,
`weist`, `shoulder`, `bot`, `arm_left`, `arm_right`, `forearm_left`,
`forearm_right`, `leg_left`, `leg_right`, `cav_left`, `cav_right`.
Body/nutrition ranges do not use the legacy 31-day cap. Food search slices the
returned candidates to the limit; its count can exceed the returned length.
These tools do not cache or index their results and expose no write operations.

## `xunji_upsert_training_day`

Off by default. Registration requires enabled training, read scope,
`WRITE_TOOLS_ENABLED=true` and write scope.

| Argument             | Type / bounds                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `date`               | Calendar date within 190 days of the current instant (approximately six months)                                                                   |
| `confirmed`          | Literal `true`, after the user confirms the exact change                                                                                          |
| `clientRequestId`    | 8–128 characters; pass the same ID for the same intended retry                                                                                    |
| `localid`            | Optional integer; update that session, otherwise create                                                                                           |
| `title`              | Optional string, 1–60 characters                                                                                                                  |
| `movements`          | 1–15 entries; each has `name` (1–40 characters) and 1–20 sets                                                                                     |
| Movement rest fields | Optional `restTime` / `warn_restTime`, integers 0–86400                                                                                           |
| Set fields           | Optional string `weight` (≤12), `unit` (≤8), `reps` (≤8), `rpe` (≤4), `setType` (≤4); integer `time` (0–86400); Boolean `selfWeight`; `done=true` |

The bridge sends one session and never sends `dry_run`. Every invocation is a
real write. There is no delete tool and no local idempotency ledger.
Do not infer vendor retry guarantees solely from the request ID.

The response has `status: "written"`, date, returned `localids`, normalized
`sessions` and metadata. A nonempty response may replace the eligible light
day-cache entry. It does not update D1 or invalidate full-mode entries.
Read back the requested change and refresh the index separately when needed.

## Error codes

| Code                                     | Meaning                                                             |
| ---------------------------------------- | ------------------------------------------------------------------- |
| `rate_limited`                           | Vendor pacing; honor the retry hint                                 |
| `unauthorized`                           | Upstream rejected a configured credential                           |
| `vip_required`                           | Account lacks required membership                                   |
| `invalid_request`                        | Upstream rejected parameters                                        |
| `upstream_unavailable`                   | Network failure, unsuccessful HTTP status or unknown vendor failure |
| `timeout`                                | Fetch was aborted by the timeout                                    |
| `bad_payload`                            | Missing usable envelope, non-JSON or oversized response buffer      |
| `not_configured`                         | Required domain key is absent                                       |
| `index_unavailable`                      | No usable derived index binding                                     |
| `invalid_range` / `range_too_large`      | Invalid or oversized window                                         |
| `invalid_fields` / `invalid_combination` | Unsupported metric selection or grouping combination                |
| `not_earlier`                            | `extend` start is not earlier than the stored start                 |
| `confirmation_required`                  | Write confirmation check failed                                     |
| `date_out_of_range`                      | Write date exceeds the 190-day guard                                |
| `internal_error`                         | Unexpected bridge failure                                           |

OAuth/protocol and schema-validation errors can occur before a tool handler.
Training text, notes and adapter records are data; clients must not treat them
as instructions.
