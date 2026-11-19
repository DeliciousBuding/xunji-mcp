-- Derived training index. The source of truth remains the Xunji account.
-- Every row here is either an upstream field or a documented derived value.

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_day (
  datestr TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('complete', 'empty', 'error', 'pending')),
  trains_count INTEGER NOT NULL DEFAULT 0,
  movements_count INTEGER NOT NULL DEFAULT 0,
  fingerprint TEXT,
  fetched_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS scan_day_status ON scan_day (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS scan_day_date ON scan_day (datestr);

CREATE TABLE IF NOT EXISTS session (
  localid INTEGER PRIMARY KEY,
  datestr TEXT NOT NULL,
  title TEXT,
  calories REAL,
  start_ms INTEGER,
  end_ms INTEGER,
  duration_s INTEGER,
  has_heart_rate INTEGER NOT NULL DEFAULT 0,
  duration_anomaly INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS session_date ON session (datestr);

CREATE TABLE IF NOT EXISTS movement (
  key TEXT PRIMARY KEY,
  localid INTEGER NOT NULL,
  datestr TEXT NOT NULL,
  movement_index INTEGER NOT NULL,
  name TEXT NOT NULL,
  muscle_group TEXT,
  exetype TEXT,
  single_side INTEGER NOT NULL DEFAULT 0,
  rest_s INTEGER,
  warmup_rest_s INTEGER,
  cardio INTEGER NOT NULL DEFAULT 0,
  record_preset TEXT
);
CREATE INDEX IF NOT EXISTS movement_date ON movement (datestr);
CREATE INDEX IF NOT EXISTS movement_name ON movement (name);

CREATE TABLE IF NOT EXISTS set_fact (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  localid INTEGER NOT NULL,
  datestr TEXT NOT NULL,
  movement_key TEXT NOT NULL,
  movement_name TEXT NOT NULL,
  muscle_group TEXT,
  set_index INTEGER NOT NULL,
  done INTEGER NOT NULL,
  is_warmup INTEGER NOT NULL,
  weight REAL,
  unit TEXT,
  reps INTEGER,
  self_weight INTEGER NOT NULL,
  single_side INTEGER NOT NULL,
  left_weight REAL,
  rpe REAL,
  volume_kg REAL,
  est_1rm_kg REAL,
  UNIQUE (movement_key, set_index)
);
CREATE INDEX IF NOT EXISTS set_fact_date ON set_fact (datestr);
CREATE INDEX IF NOT EXISTS set_fact_movement ON set_fact (movement_name, datestr);
CREATE INDEX IF NOT EXISTS set_fact_group ON set_fact (muscle_group, datestr);
