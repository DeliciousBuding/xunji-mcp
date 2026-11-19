# Upstream contract notes

Verified against the operator's own account on 2026-11-19. No fixture in this
file contains real training values; only shapes and status codes are recorded.

## Read one day

```
POST https://trains.xunjiapp.cn/api_trains_for_llm_v2
Authorization: Bearer <key>
Content-Type: application/json

{"schema_version":"train_open_api_v2","datestr":"YYYY-MM-DD","include_full_data":false}
```

- 200 with `{"res": {...}}` on success.
- 200 with `{"success":false,"res":"too frequent, retry after 30s"}` when paced.
- 200 with `{"success":false,"res":"apikey invalid"}` for a wrong/other-domain key.
- 200 with `{"success":false,"error":"datestr invalid"}` for a malformed date.
- `res.limits` carries the vendor's own pacing numbers.
- `res.trains[]` is empty for a day with no training; this is not an error.
- Large replies may be gzip-compressed at the transfer layer.

`include_full_data: true` adds unchecked sets, RPE, notes, comments, left-side
weight, per-set rest and compressed heart-rate summaries, and moves the read
pacing to 30 seconds.

## Movement catalog

```
POST https://trains.xunjiapp.cn/api_movement_catalog_for_llm_v2
{}
```

Returns `{"res":{"schema":"movement_catalog_v1","version":1,"movements":[...]}}`
with about 1,200 entries. Observed to answer without a valid key.

## Official plans

```
POST https://api.xunjiapp.cn/open/plan/query_gzip
{"schema_version":"plan_open_api_v1","action":"list"}
{"schema_version":"plan_open_api_v1","action":"get","plan_ref":"universal:4",
 "start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD","include_movements":true}
```

Returns `{"success":true,"res":{...}}`, gzip-compressed. `get` defaults to -7d
through +30d and supports at most 92 days.

## Write (not used by default)

```
POST https://trains.xunjiapp.cn/api_upsert_trains_for_llm_v2
{"schema_version":"train_open_api_v2","client_request_id":"...","res":[ ... ]}
```

- Upserts by `localid`; without it, creates.
- Limits: 4 trains/day, 15 movements/train, 20 sets/movement for writes.
- **`dry_run` is ignored.** A request containing `"dry_run": true` created a
  record. Treat every call as a real write.
- No delete operation is documented or observable.

## Domains this bridge does not expose

Body and food/nutrition endpoints use separate keys (`xjbody_`, `xjfood_`); the
training key is rejected with `apikey invalid`. They are intentionally not
registered.

## Source of truth

- Vendor Agent Skill: training-data, food, body, plan and template documents
  distributed by Xunji.
- Public movement names: <https://github.com/Foveluy/Xunji-movements>.
- This file records only behavior that was actually observed; anything else is
  marked as unverified rather than assumed.
