# Benchmark: per-day reads vs the derived query layer

Measured with `npm run bench` in local workerd (Miniflare + D1). The dataset is
deterministic synthetic history; no real training data is involved.

## Results

|  Days | 0.1 approach                                     | 0.1 tool calls |               0.1 output | 0.2 overview              | 0.2 calls |         0.2 output | 0.2 cold / warm |
| ----: | ------------------------------------------------ | -------------: | -----------------------: | ------------------------- | --------: | -----------------: | --------------: |
|   365 | `xunji_list_training_days`, 2 uncached days/call |            183 |  142,607 B / ~43,830 tok | `xunji_training_overview` |         1 | 1,439 B / ~552 tok |   40 ms / 25 ms |
| 1,095 | same                                             |            548 | 427,906 B / ~131,449 tok | `xunji_training_overview` |         1 | 1,444 B / ~555 tok |   61 ms / 37 ms |

Reduction: **183× → 1 call** at one year and **548× → 1 call** at three years;
default overview output is **~99×–296× smaller** than the accumulated range
payloads.

A monthly grouped query over three years returns 37 rows in 2,565 B (~985 tok).
The index itself is queried three times per overview (totals, monthly series,
top movements).

## Methodology

- Seed: one synthetic session on 4 days/week, 5 movements per session, warm-up
  and working sets, bodyweight and unilateral work, one duration anomaly per 37
  days. Seeded through the production `replaceDay()` path into D1.
- 0.1 numbers: the exact `xunji_list_training_days` payload shape for two days,
  serialized once per call and summed over `ceil(days / 2)` calls; the upstream
  read count is one per day. Latency is an estimate from measured vendor
  round-trip times (~250 ms) plus call overhead, not a live 183-call run.
- 0.2 numbers: one `trainingOverview` call on a warm D1, measured with
  `performance.now()`; the first (cold) and second (warm) call are both shown.
- Tokens: `gpt-tokenizer` over the exact JSON returned to the client.
- Coverage in both runs: complete (every seeded day scanned).

## What this does and does not prove

Proves: the query layer removes hundreds of MCP round trips and shrinks the
default context payload by two orders of magnitude for the same analysis task.

Does not prove: production cold-start latency, multi-region D1 behaviour, or the
cost of the one-time historical backfill. Backfill is one upstream read per day
(the vendor has no bulk endpoint) and runs in a Durable Object alarm loop at
concurrency 3; it is bounded by the vendor's per-day pacing and by politeness,
not by a client loop.

## Reproduce

```bash
npm run bench            # 365 days
BENCH_DAYS=1095 npm run bench
```

Raw results are in `bench/results-365.json` and `bench/results-1095.json`.
