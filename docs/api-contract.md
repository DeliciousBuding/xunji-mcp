# Upstream contract notes

[English](api-contract.md) · [简体中文](api-contract.zh-CN.md)

This document separates previously observed upstream behavior from adapter
requests implemented from the vendor's skills. It records shapes and failure
forms, not account data or a deployment's verification result. Examples use
placeholders only.

The request implementations are in [the training client](../src/upstream/client.ts)
and [the optional domain adapters](../src/upstream/domains.ts). A tool's
normalized output is a bridge contract; it is not the complete upstream schema.

## Shared response handling

Requests are JSON POSTs. Authenticated endpoints receive a Worker secret in
`Authorization: Bearer <domain-key>`. The catalog request is unauthenticated.
The client requests gzip and detects gzip magic bytes if the runtime has not
already decompressed the body.

Successful responses wrap an object or array in `res`. `success` can be absent,
so the client does not use that flag alone as its success signal. Previously
observed training failure forms include:

```json
{ "success": false, "res": "too frequent, retry after 30s" }
```

```json
{ "success": false, "res": "apikey invalid" }
```

```json
{ "success": false, "error": "datestr invalid" }
```

These application failures can arrive with HTTP 200. The client classifies
string `res` values, bare string envelopes, and object `error.message` values.
An envelope containing a string `error` but no usable `res` currently maps to
`bad_payload`; it is not normalized to `invalid_request`.

HTTP 401/403 map to `unauthorized`; other unsuccessful HTTP statuses map to
`upstream_unavailable`. Unknown vendor text is replaced with a generic message.
A retry hint matching `retry after Ns` becomes `retryAfterSeconds`.

The default fetch timeout is 15 seconds, configurable with
`UPSTREAM_TIMEOUT_MS` (minimum accepted value: 1000 ms). The timer covers the
fetch until headers arrive. Body reading and decompression have no separate
timer. The client checks the fully read response buffer against 2 MiB before
its own decompression; this is neither a streaming cap nor a separate cap on
the inflated payload.

## Read one training day

```text
POST https://trains.xunjiapp.cn/api_trains_for_llm_v2
Authorization: Bearer <training-key>
Content-Type: application/json

{"schema_version":"train_open_api_v2","datestr":"YYYY-MM-DD","include_full_data":false}
```

The usable payload is `res`, with optional schema/version fields, `datestr`,
`limits`, `truncated` and `trains`. A session carries its `localid`, date,
optional title/timestamps and movements. Movements contain names, optional
classification/rest fields and sets. Set weights and reps can be strings.
Unrecognized fields are not given invented schemas.

An empty `trains` array is a successful read of a day with no recorded training.
`limits` carries vendor limits, including light/full read pacing and write
limits. The observed training limits include four sessions per day,
15 movements per written session and 20 sets per written movement.

Light reads use 15-second spacing. `include_full_data: true` uses 30 seconds
and can add unchecked sets, RPE, notes/comments, left-side weight and heart-rate
data. The bridge returns a selected normalized representation, not every field
or the compressed heart-rate payload.

The API uses calendar-day strings and carries no timezone parameter. The
bridge preserves the date and evaluates defaults in `Asia/Shanghai`.

## Movement catalog

```text
POST https://trains.xunjiapp.cn/api_movement_catalog_for_llm_v2
Content-Type: application/json

{}
```

The observed response is a `res` object with schema/version metadata and
`movements`. Entries contain a canonical name and may contain `type`,
`exetype` and aliases. The endpoint has answered without a valid training key;
the bridge deliberately sends no Authorization header.

Catalog size is not a stable contract. The MCP search applies a substring
match to names and aliases and caches the public catalog for seven days when
the cache budget allows.

## Official plans

```text
POST https://api.xunjiapp.cn/open/plan/query_gzip
Authorization: Bearer <training-key>
Content-Type: application/json

{"schema_version":"plan_open_api_v1","action":"list"}
```

```text
{"schema_version":"plan_open_api_v1","action":"get","plan_ref":"<plan-ref-from-list>",
 "start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD","include_movements":true}
```

Previously observed replies use `{"success":true,"res":{...}}` and may be
gzip-compressed. List results expose `plans`; get results are consumed through
`plan`, `days` and `date_range`. The bridge leaves those nested plan values
opaque.

The MCP get tool supplies defaults of seven days back through 30 days forward
and enforces a 1–92 day window. These are bridge defaults and bounds.
A populated day-schedule contract has not been verified. Empty `days` does
not establish that plan comparison is supported.

## Training upsert

```text
POST https://trains.xunjiapp.cn/api_upsert_trains_for_llm_v2
Authorization: Bearer <training-key>
Content-Type: application/json

{"schema_version":"train_open_api_v2","client_request_id":"<request-id>",
 "res":[<session-object>]}
```

These are wire-shape placeholders, not an executable write example.

- Supplying a session `localid` updates that session; omitting it creates one.
- The bridge sends exactly one session per write-tool call, with 1–15
  movements and 1–20 sets per movement.
- `client_request_id` is passed upstream. The bridge keeps no local
  idempotency ledger and does not establish the vendor's retry guarantees.
- The vendor ignores `dry_run`. Every request to this endpoint must be
  treated as a real write; the bridge never serializes the flag.
- No upstream delete operation is documented or implemented by this bridge.

The tool defaults off and requires enabled training, read and write scopes,
`WRITE_TOOLS_ENABLED=true` and `confirmed: true`. The date guard compares the
parsed date with the current instant using a 190-day bound, described to
clients as approximately six months. See [tools](tools.md) for the input
contract and index-refresh behavior.

## Optional adapter requests: not live-verified

Body and nutrition use independent keys. A training key rejected by those
domains does not verify their success response. The following table describes
the requests in the current adapter code, sourced from vendor skills; it does
not promote them to observed live contracts.

| Adapter           | Endpoint                                                   | Secret                  | JSON request fields                                                                                |
| ----------------- | ---------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------- |
| Body measurements | `POST https://api.xunjiapp.cn/open/body/query_gzip`        | `XUNJI_BODY_KEY`        | `start_date`, `end_date`, optional `types`, `include_latest`, `include_records`, `limit`, `offset` |
| Food records      | `POST https://eatings.xunjiapp.cn/open/food/query_gzip`    | `XUNJI_FOOD_KEY`        | `start_date`, `end_date`, `include_detail`                                                         |
| Food search       | `POST https://api.xunjiapp.cn/open_agent/food/search_gzip` | `XUNJI_FOOD_SEARCH_KEY` | `keyword`, `limit`                                                                                 |

Body normalization accepts `records` and attempts to expose `latest`.
Food-record normalization accepts arrays named `records`, `foods` or `data`;
a reply with none of those arrays is rejected. Food search accepts `foods`
or a columnar `d` array. These are current parsing choices, not proof of
complete pagination, latest-value accuracy or live compatibility.

Tools register only with the matching secret and `body` or `nutrition` in
`ENABLED_DATA_DOMAINS`. Their output remains `verified: false`. They expose no
write operations.

## Sources and verification

- Xunji's vendor-distributed training, plan, body, food and template Agent Skills.
- Public canonical movement names: <https://github.com/Foveluy/Xunji-movements>.
- The bridge source and the limits described above.

Templates and plan mutations are outside the implemented tool surface.
Deployment verification belongs in a private operator record; the public
[coverage guide](coverage.md) explains what can be checked without publishing
training values or deployment identifiers.
