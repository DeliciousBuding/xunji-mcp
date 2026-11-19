# Benchmark: per-day reads vs the derived query layer

[English](benchmark.md) | [简体中文](benchmark.zh-CN.md)

The existing results were measured with `npm run bench` in local workerd
(Miniflare + D1), using deterministic synthetic history. This documentation
update did not rerun the benchmark. No real training data is involved.

## Results

|  Days | 0.1 approach                                     | 0.1 tool calls |               0.1 output | 0.2 overview              | 0.2 calls |         0.2 output | 0.2 cold / warm |
| ----: | ------------------------------------------------ | -------------: | -----------------------: | ------------------------- | --------: | -----------------: | --------------: |
|   365 | `xunji_list_training_days`, 2 uncached days/call |            183 |  142,607 B / ~43,830 tok | `xunji_training_overview` |         1 | 1,439 B / ~552 tok |   40 ms / 25 ms |
| 1,095 | same                                             |            548 | 427,906 B / ~131,449 tok | `xunji_training_overview` |         1 | 1,444 B / ~555 tok |   61 ms / 37 ms |

The modeled legacy approach needs 183 or 548 calls; the indexed overview needs
one tool call after backfill. Its serialized JSON is approximately 99–296 times
smaller in bytes than the accumulated legacy range payloads for these datasets.

A monthly grouped query over three years returns 37 rows in 2,565 B (~985 tok).
The index itself is queried three times per overview (totals, monthly series,
top movements).

## Methodology

- Seed: one synthetic session on 4 days/week, 5 movements per session, warm-up
  and working sets, bodyweight and unilateral work, one duration anomaly per 37
  days. The application `replaceDay()` function seeds local D1; this is not a
  production deployment or an upstream backfill.
- 0.1 numbers: the benchmark reconstructs the two-day
  `xunji_list_training_days` payload shape, serializes each chunk and sums over
  `ceil(days / 2)` modeled calls. It does not invoke the old MCP tool or make
  vendor requests. One upstream read per day is assumed. The raw artifacts'
  legacy latency uses fixed assumptions of 250 ms/read and 50 ms/tool call;
  it is an estimate, not a measured live run.
- 0.2 numbers: `trainingOverview` queries a seeded local D1. `performance.now()`
  measures the first call after seeding ("cold") and the second ("warm").
  Neither number measures a Worker cold start or remote D1 latency.
- Bytes and tokens: serialized benchmark JSON objects, with `gpt-tokenizer` for
  token estimates. MCP envelopes, additional text summaries, prompts and client
  rendering are excluded.
- Coverage in both runs: complete (every seeded day scanned).

## Scope and limitations

For the seeded datasets and the modeled per-day baseline, an indexed overview
reduces tool round trips and serialized output for a history summary. It does
not reproduce every legacy response, query shape or client conversation.

These results do not establish production latency, multi-region D1 behaviour,
account-wide quota safety or the elapsed time/cost of initial backfill. A live
backfill still needs one upstream read per day and runs in a Durable Object
alarm loop at concurrency 3. It observes vendor pacing and `SCAN_DAILY_LIMIT`
(default 100 days per UTC day). Coverage must be checked before interpreting
an all-history result; the benchmark starts with complete local coverage.

## Reproduce

```bash
npm run bench            # 365 days
BENCH_DAYS=1095 npm run bench
```

These commands run a synthetic local benchmark, not a production probe.
Raw artifacts: [365 days](../bench/results-365.json) and
[1,095 days](../bench/results-1095.json). The measurement code is
[bench/bench.test.ts](../bench/bench.test.ts). See
[Acceptance](acceptance.md) for the separate historical verification record.
