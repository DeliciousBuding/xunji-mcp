# Upstream coverage matrix

The table mirrors `src/capabilities.ts`. `xunji_capabilities` returns the live
version, including whether a domain is configured in the current deployment.

| Domain    | Capability                         | Endpoint                                                  | Tool                                                                         | Scope         | Configured here   | Verified live  |
| --------- | ---------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------- | ----------------- | -------------- |
| training  | read one day                       | `POST trains.xunjiapp.cn/api_trains_for_llm_v2`           | `xunji_get_training_day`                                                     | `xunji:read`  | yes               | yes            |
| training  | indexed range / grouped metrics    | derived index                                             | `xunji_query_training`                                                       | `xunji:read`  | yes               | yes            |
| training  | all-history overview               | derived index                                             | `xunji_training_overview`                                                    | `xunji:read`  | yes               | yes            |
| training  | PR / e1RM / plateau                | derived index                                             | `xunji_movement_progress`                                                    | `xunji:read`  | yes               | yes            |
| training  | coverage + backfill                | D1 + scan coordinator                                     | `xunji_history`                                                              | `xunji:read`  | yes               | yes            |
| training  | legacy bounded range/stats/history | per-day endpoint                                          | `xunji_list_training_days`, `xunji_training_stats`, `xunji_movement_history` | `xunji:read`  | yes               | yes            |
| training  | movement name catalog              | `POST trains.xunjiapp.cn/api_movement_catalog_for_llm_v2` | `xunji_search_movements`                                                     | `xunji:read`  | yes               | yes            |
| plans     | list / read official plans         | `POST api.xunjiapp.cn/open/plan/query_gzip`               | `xunji_list_plans`, `xunji_get_plan`                                         | `xunji:read`  | yes               | yes (list/get) |
| body      | weight, body fat, measurements     | `POST api.xunjiapp.cn/open/body/query_gzip`               | `xunji_body_query`                                                           | `xunji:read`  | **no**            | no             |
| nutrition | food records                       | `POST eatings.xunjiapp.cn/open/food/query_gzip`           | `xunji_nutrition_query`                                                      | `xunji:read`  | **no**            | no             |
| nutrition | official food search               | `POST api.xunjiapp.cn/open_agent/food/search_gzip`        | `xunji_search_foods`                                                         | `xunji:read`  | **no**            | no             |
| templates | personal template sync/mutation    | `POST trains.xunjiapp.cn/api_agent_templates_*`           | —                                                                            | —             | **no**            | no             |
| training  | write/upsert days                  | `POST trains.xunjiapp.cn/api_upsert_trains_for_llm_v2`    | `xunji_upsert_training_day`                                                  | `xunji:write` | **no** (disabled) | mock only      |

Notes:

- Body and nutrition require **different Xunji keys** from the training key. The
  adapters are implemented from the official skills but are not registered
  without the matching secret. They are marked unverified until observed live.
- Template mutation is intentionally out of scope: it needs another key and is a
  write surface.
- Plan day-level comparison is not implemented: the only plan available in this
  deployment (`universal:4`) returned an empty `days` array, so the day schedule
  contract could not be verified.
- Training writes remain disabled. The vendor ignores `dry_run`, so enabling
  writes is a real production decision, not a preview.
