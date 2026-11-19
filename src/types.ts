/**
 * Shared types for the Xunji Open API bridge.
 *
 * Everything here mirrors only what the vendor's own Open API skill documents
 * and what was observed on the live read-only endpoint. No field is invented:
 * unknown shapes stay as `unknown` rather than being given a fake schema.
 */

/** Domains of upstream data this deployment can expose. */
export type DataDomain = 'train';

/** OAuth scopes this authorization server can grant. */
export const SCOPES = {
  /** Read training days, movement history and aggregates. */
  read: 'xunji:read',
  /** Write training records. Disabled unless explicitly enabled at deploy time. */
  write: 'xunji:write',
} as const;

export type Scope = (typeof SCOPES)[keyof typeof SCOPES];

/** Props encrypted into the OAuth token and handed back to the MCP handler. */
export interface AuthProps {
  /** Stable, non-reversible subject identifier for the allowlisted operator. */
  subject: string;
  /** Human label of the allowlisted operator (email local-part only). */
  label: string;
  /** Granted scopes at authorization time. */
  scope: string[];
  [key: string]: unknown;
}

/** Environment bindings. Secrets are never read from vars. */
export interface Env {
  OAUTH_KV: KVNamespace;
  CACHE_KV: KVNamespace;
  UPSTREAM_GATE: DurableObjectNamespace<import('./gate').UpstreamGate>;

  /** Injected by @cloudflare/workers-oauth-provider on the default handler path. */
  OAUTH_PROVIDER: import('@cloudflare/workers-oauth-provider').OAuthHelpers;

  PUBLIC_ORIGIN: string;
  MCP_RESOURCE_PATH: string;
  ALLOWED_USER_EMAILS: string;
  ENABLED_DATA_DOMAINS: string;
  WRITE_TOOLS_ENABLED: string;
  UPSTREAM_TIMEOUT_MS: string;

  /** Cloudflare Access team domain, e.g. `team.cloudflareaccess.com`. */
  ACCESS_TEAM_DOMAIN?: string;
  /** Cloudflare Access application audience (AUD) tag. */
  ACCESS_AUD?: string;
  /** Fallback operator gate for deployments without Cloudflare Access. */
  OWNER_PASSPHRASE?: string;

  /**
   * The operator's own Xunji Open API key.
   * `wrangler secret put XUNJI_API_KEY` — never a var, never logged.
   */
  XUNJI_API_KEY?: string;

  /** Optional: shared secret for the /healthz deployment probe. */
  HEALTH_TOKEN?: string;
}

/* ------------------------------------------------------------------ */
/* Upstream wire types (read-only surface actually verified)            */
/* ------------------------------------------------------------------ */

export interface XunjiLimits {
  maxTrainsPerDay: number;
  maxMovesPerTrain: number;
  maxSetsPerMove: number;
  maxWriteMovesPerTrain: number;
  maxWriteSetsPerMove: number;
  maxPayloadBytes: number;
  maxResponseBytes: number;
  readRateLimitSeconds: number;
  readRateLimitSecondsLight: number;
  readRateLimitSecondsFull: number;
  writeRateLimitSeconds: number;
}

export interface XunjiSet {
  index?: number;
  done?: boolean;
  weight?: string;
  unit?: string;
  reps?: string;
  time?: number;
  timeLabel?: string;
  selfWeight?: boolean;
  /** Present only with include_full_data. */
  rpe?: string;
  note?: string;
  comment?: string;
  setType?: string;
  leftWeight?: string;
  /** Cardio / health-record metrics when present. */
  metrics?: Record<string, string | number>;
  /** Compressed heart-rate trend, present only with include_full_data. */
  heartRate?: Record<string, unknown>;
  /** Superset children. */
  items?: Array<{ name?: string; set?: XunjiSet }>;
  dropSets?: XunjiSet[];
}

export interface XunjiMovement {
  index?: number;
  name: string;
  type?: string;
  exetype?: string;
  sets?: XunjiSet[];
  truncated?: boolean;
  note?: string;
  singleSide?: boolean;
  restTime?: number;
  warn_restTime?: number;
  cardio?: boolean;
  recordPreset?: string;
  metrics?: Record<string, string | number>;
}

export interface XunjiTrain {
  localid: number;
  datestr: string;
  title?: string;
  note?: string;
  start?: number;
  end?: number;
  started_at?: number;
  ended_at?: number;
  movements?: XunjiMovement[];
  truncated?: boolean;
  heartRate?: Record<string, unknown>;
}

export interface XunjiTrainResponse {
  schema?: string;
  schema_version?: string;
  version?: number;
  mode?: string;
  includeFullData?: boolean;
  include_full_data?: boolean;
  datestr?: string;
  movementCatalogUrl?: string;
  movement_catalog_url?: string;
  limits?: XunjiLimits;
  truncated?: boolean;
  trains?: XunjiTrain[];
}

/**
 * Every upstream reply is `{ res }`, where `res` is either the payload object
 * or a human-readable failure string. `success` is sometimes present and
 * sometimes absent, so it is not used as the success signal.
 */
export interface XunjiEnvelope<T> {
  success?: boolean;
  res: T | string;
  error?: { message?: string; field?: string; code?: string } | string;
}

/* ------------------------------------------------------------------ */
/* Normalized output types (what agents actually receive)              */
/* ------------------------------------------------------------------ */

export interface NormalizedSet {
  index: number;
  done: boolean;
  setType?: 'warmup' | 'work';
  weight?: number | null;
  weightUnit?: string | null;
  leftWeight?: number | null;
  reps?: number | null;
  selfWeight?: boolean;
  durationSeconds?: number | null;
  rpe?: number | null;
  distanceMeters?: number | null;
  metrics?: Record<string, string | number>;
  note?: string;
  comment?: string;
}

export interface NormalizedMovement {
  index: number;
  name: string;
  category?: string;
  exerciseType?: string;
  totalSets: number;
  completedSets: number;
  totalReps: number;
  totalVolumeKg: number;
  topSetWeightKg: number | null;
  restSeconds?: number | null;
  warmupRestSeconds?: number | null;
  singleSide?: boolean;
  note?: string;
  sets: NormalizedSet[];
  superset?: Array<{ name: string; sets: NormalizedSet[] }>;
  cardio?: boolean;
  recordPreset?: string;
  metrics?: Record<string, string | number>;
}

export interface NormalizedTrain {
  localid: number;
  date: string;
  title?: string;
  /** Parsed note fields only; free text is dropped unless `includeNotes`. */
  noteText?: string;
  calories?: number | null;
  color?: string | null;
  startMs?: number;
  endMs?: number;
  durationMinutes?: number;
  movements: NormalizedMovement[];
  movementCount: number;
  completedSetCount: number;
  totalVolumeKg: number;
  hasHeartRate: boolean;
  heartRate?: { avg?: number; max?: number; min?: number; samples?: number };
  truncated: boolean;
}

export interface DaySummary {
  date: string;
  trainCount: number;
  title?: string;
  movementCount: number;
  completedSetCount: number;
  totalVolumeKg: number;
  durationMinutes: number;
  hasHeartRate: boolean;
  localids: number[];
  truncated: boolean;
}

export interface UpstreamMeta {
  /** Rate-limit spacing the vendor advertises for this read mode. */
  readRateLimitSeconds: number;
  /** True when the reply was served from cache rather than upstream. */
  cached: boolean;
  /** How long the cached copy is considered fresh. */
  cacheAgeSeconds?: number;
  /** Populated on this upstream's soft rate-limit replies. */
  retryAfterSeconds?: number;
  upstreamTruncated?: boolean;
}

export interface ToolResultMeta {
  upstream: UpstreamMeta;
  limits?: XunjiLimits;
}