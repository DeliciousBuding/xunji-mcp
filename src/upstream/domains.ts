/**
 * Optional domains: body measurements, food records and food search.
 *
 * These use different vendor keys from the training API. A deployment without
 * the matching secret does not register the tools at all, so a model never
 * discovers an endpoint it cannot use. The request/response shapes come from
 * the vendor's own food and body skills; they remain marked unverified until a
 * live response is observed in a deployment that supplies the key.
 */

import type { Env } from '../types';
import { postJson, UpstreamError } from './client';

export const DOMAIN_UPSTREAM = {
  bodyPath: 'https://api.xunjiapp.cn/open/body/query_gzip',
  foodQueryPath: 'https://eatings.xunjiapp.cn/open/food/query_gzip',
  foodSearchPath: 'https://api.xunjiapp.cn/open_agent/food/search_gzip',
} as const;

export type BodyType =
  | 'weight'
  | 'bodyfat'
  | 'neck'
  | 'chest'
  | 'weist'
  | 'shoulder'
  | 'bot'
  | 'arm_left'
  | 'arm_right'
  | 'forearm_left'
  | 'forearm_right'
  | 'leg_left'
  | 'leg_right'
  | 'cav_left'
  | 'cav_right';

export const BODY_TYPES: BodyType[] = [
  'weight',
  'bodyfat',
  'neck',
  'chest',
  'weist',
  'shoulder',
  'bot',
  'arm_left',
  'arm_right',
  'forearm_left',
  'forearm_right',
  'leg_left',
  'leg_right',
  'cav_left',
  'cav_right',
];

export interface BodyRecord {
  datestr: string;
  type: string;
  value: number | null;
  unit: string | null;
  label: string | null;
}

export interface BodyQueryResult {
  records: BodyRecord[];
  latest: Record<string, BodyRecord>;
  byType: Record<string, BodyRecord[]>;
  retrieved: number;
}

function bodyKey(env: Env): string {
  const key = env.XUNJI_BODY_KEY?.trim();
  if (!key) throw new UpstreamError('not_configured', 'No Xunji body-data key is configured.');
  return key;
}

export async function readBody(
  env: Env,
  input: {
    from: string;
    to: string;
    types?: BodyType[];
    includeLatest?: boolean;
    includeRecords?: boolean;
    limit?: number;
    offset?: number;
  },
  signal?: AbortSignal,
): Promise<BodyQueryResult> {
  const { value } = await postJson<Record<string, unknown>>(
    env,
    DOMAIN_UPSTREAM.bodyPath,
    {
      start_date: input.from,
      end_date: input.to,
      ...(input.types?.length ? { types: input.types } : {}),
      include_latest: input.includeLatest !== false,
      include_records: input.includeRecords !== false,
      limit: Math.min(1000, Math.max(1, input.limit ?? 500)),
      offset: Math.max(0, input.offset ?? 0),
    },
    { authRequired: true, key: bodyKey(env), signal },
  );

  const rawRecords = Array.isArray(value.records) ? value.records : [];
  const records: BodyRecord[] = rawRecords
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map((row) => ({
      datestr: typeof row.datestr === 'string' ? row.datestr : '',
      type: typeof row.type === 'string' ? row.type : '',
      value:
        typeof row.value === 'number'
          ? row.value
          : Number.isFinite(Number(row.value))
            ? Number(row.value)
            : null,
      unit: typeof row.unit === 'string' ? row.unit : null,
      label: typeof row.label === 'string' ? row.label : null,
    }))
    .filter((row) => row.datestr && row.type);

  const latest: Record<string, BodyRecord> = {};
  if (value.latest && typeof value.latest === 'object') {
    for (const [type, row] of Object.entries(value.latest as Record<string, unknown>)) {
      if (row && typeof row === 'object') {
        const record = records.find((candidate) => candidate.type === type) ?? null;
        if (record) latest[type] = record;
      }
    }
  }
  const byType: Record<string, BodyRecord[]> = {};
  for (const record of records) (byType[record.type] ??= []).push(record);

  return { records, latest, byType, retrieved: records.length };
}

export interface FoodRecord {
  date: string;
  mealType: string | null;
  name: string;
  amount: number | null;
  unit: string | null;
  calories: number | null;
  protein: number | null;
  fat: number | null;
  carb: number | null;
}

function foodKey(env: Env): string {
  const key = env.XUNJI_FOOD_KEY?.trim();
  if (!key) throw new UpstreamError('not_configured', 'No Xunji food-data key is configured.');
  return key;
}

export async function readFoodRecords(
  env: Env,
  input: { from: string; to: string; includeDetail?: boolean },
  signal?: AbortSignal,
): Promise<{ records: FoodRecord[]; retrieved: number }> {
  const { value } = await postJson<Record<string, unknown>>(
    env,
    DOMAIN_UPSTREAM.foodQueryPath,
    {
      start_date: input.from,
      end_date: input.to,
      include_detail: input.includeDetail !== false,
    },
    { authRequired: true, key: foodKey(env), signal },
  );

  const raw = Array.isArray(value.records)
    ? value.records
    : Array.isArray(value.foods)
      ? value.foods
      : Array.isArray(value.data)
        ? value.data
        : [];
  if (
    raw.length === 0 &&
    !Array.isArray(value.records) &&
    !Array.isArray(value.foods) &&
    !Array.isArray(value.data)
  ) {
    throw new UpstreamError(
      'bad_payload',
      'The food response shape is not the one documented by the vendor skill.',
    );
  }

  const records: FoodRecord[] = raw
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map((row) => ({
      date:
        typeof row.date === 'string'
          ? row.date
          : typeof row.datestr === 'string'
            ? row.datestr
            : '',
      mealType: typeof row.meal_type === 'string' ? row.meal_type : null,
      name: typeof row.name === 'string' ? row.name : '',
      amount: numberOrNull(row.amount),
      unit: typeof row.unit === 'string' ? row.unit : null,
      calories: numberOrNull(row.cal ?? row.calories),
      protein: numberOrNull(row.protein),
      fat: numberOrNull(row.fat),
      carb: numberOrNull(row.carb),
    }))
    .filter((row) => row.date && row.name);

  return { records, retrieved: records.length };
}

export async function searchFoods(
  env: Env,
  keyword: string,
  limit = 8,
  signal?: AbortSignal,
): Promise<{ foods: Array<Record<string, unknown>>; count: number }> {
  const key = env.XUNJI_FOOD_SEARCH_KEY?.trim();
  if (!key) throw new UpstreamError('not_configured', 'No Xunji food-search key is configured.');
  const { value } = await postJson<Record<string, unknown>>(
    env,
    DOMAIN_UPSTREAM.foodSearchPath,
    { keyword, limit: Math.min(20, Math.max(1, limit)) },
    { authRequired: true, key, signal },
  );
  const foods = Array.isArray(value.foods)
    ? value.foods
    : Array.isArray(value.d)
      ? value.d.map((row) => (Array.isArray(row) ? { name: row[1], calories: row[2] } : row))
      : [];
  return {
    foods: foods
      .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
      .slice(0, limit),
    count: foods.length,
  };
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
