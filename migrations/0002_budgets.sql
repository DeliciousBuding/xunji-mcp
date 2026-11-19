-- Quota guardrails: both counters are UTC-day scoped because Cloudflare's
-- free KV quota resets on the UTC day boundary.

CREATE TABLE IF NOT EXISTS kv_budget (
  day TEXT PRIMARY KEY,
  writes INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scan_budget (
  day TEXT PRIMARY KEY,
  days INTEGER NOT NULL DEFAULT 0
);
