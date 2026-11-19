/**
 * Capability matrix.
 *
 * One place answers: which upstream endpoint is implemented, which tool exposes
 * it, which secret enables it, and whether it has been verified against the
 * live vendor contract. Unconfigured domains are reported, never registered as
 * tools, so a model cannot discover them by trial and error.
 */

import type { Env } from './types';

export type CapabilityStatus = 'ready' | 'unconfigured' | 'not_implemented' | 'disabled';

export interface CapabilityRow {
  domain: 'training' | 'plans' | 'body' | 'nutrition' | 'templates' | 'index';
  capability: string;
  endpoint: string;
  tool: string | null;
  scope: string;
  configured: boolean;
  verified: boolean;
  status: CapabilityStatus;
  notes?: string;
}

export function capabilityMatrix(env: Env): CapabilityRow[] {
  const hasTrain = Boolean(env.XUNJI_API_KEY);
  const hasBody = Boolean(env.XUNJI_BODY_KEY);
  const hasFood = Boolean(env.XUNJI_FOOD_KEY);
  const hasFoodSearch = Boolean(env.XUNJI_FOOD_SEARCH_KEY);
  const hasIndex = Boolean(env.DB && env.SCAN_COORDINATOR);

  return [
    {
      domain: 'training',
      capability: 'read one training day',
      endpoint: 'POST trains.xunjiapp.cn/api_trains_for_llm_v2',
      tool: 'xunji_get_training_day',
      scope: 'xunji:read',
      configured: hasTrain,
      verified: true,
      status: hasTrain ? 'ready' : 'unconfigured',
    },
    {
      domain: 'training',
      capability: 'range/list/stats over indexed history',
      endpoint: 'derived index over /api_trains_for_llm_v2',
      tool: 'xunji_query_training',
      scope: 'xunji:read',
      configured: hasTrain && hasIndex,
      verified: hasIndex,
      status: hasTrain && hasIndex ? 'ready' : hasIndex ? 'unconfigured' : 'disabled',
      notes: 'Requires D1 plus a completed backfill for full coverage.',
    },
    {
      domain: 'training',
      capability: 'all-history overview',
      endpoint: 'derived index over /api_trains_for_llm_v2',
      tool: 'xunji_training_overview',
      scope: 'xunji:read',
      configured: hasTrain && hasIndex,
      verified: hasIndex,
      status: hasTrain && hasIndex ? 'ready' : hasIndex ? 'unconfigured' : 'disabled',
    },
    {
      domain: 'training',
      capability: 'movement PR / estimated 1RM / plateau',
      endpoint: 'derived index over /api_trains_for_llm_v2',
      tool: 'xunji_movement_progress',
      scope: 'xunji:read',
      configured: hasTrain && hasIndex,
      verified: hasIndex,
      status: hasTrain && hasIndex ? 'ready' : hasIndex ? 'unconfigured' : 'disabled',
    },
    {
      domain: 'training',
      capability: 'index coverage and backfill control',
      endpoint: 'D1 index + scan coordinator',
      tool: 'xunji_history',
      scope: 'xunji:read',
      configured: hasTrain && hasIndex,
      verified: hasIndex,
      status: hasTrain && hasIndex ? 'ready' : hasIndex ? 'unconfigured' : 'disabled',
    },
    {
      domain: 'training',
      capability: 'legacy bounded range/history/stats',
      endpoint: 'POST trains.xunjiapp.cn/api_trains_for_llm_v2',
      tool: 'xunji_list_training_days / xunji_movement_history / xunji_training_stats',
      scope: 'xunji:read',
      configured: hasTrain,
      verified: true,
      status: hasTrain ? 'ready' : 'unconfigured',
      notes: 'Kept for clients that connected before 0.2; prefer the query tools.',
    },
    {
      domain: 'training',
      capability: 'movement name catalog',
      endpoint: 'POST trains.xunjiapp.cn/api_movement_catalog_for_llm_v2',
      tool: 'xunji_search_movements',
      scope: 'xunji:read',
      configured: true,
      verified: true,
      status: 'ready',
    },
    {
      domain: 'plans',
      capability: 'list/read official plans',
      endpoint: 'POST api.xunjiapp.cn/open/plan/query_gzip',
      tool: 'xunji_list_plans / xunji_get_plan',
      scope: 'xunji:read',
      configured: hasTrain,
      verified: true,
      status: hasTrain ? 'ready' : 'unconfigured',
      notes: 'A plan with per-day schedules was not available to verify day-level comparison.',
    },
    {
      domain: 'body',
      capability: 'query weight, body fat and measurements',
      endpoint: 'POST api.xunjiapp.cn/open/body/query_gzip',
      tool: 'xunji_body_query',
      scope: 'xunji:read',
      configured: hasBody,
      verified: false,
      status: hasBody ? 'ready' : 'unconfigured',
      notes:
        'Needs a separate Xunji body-data key. Contract implemented from the official skill; live response not verified in this deployment.',
    },
    {
      domain: 'nutrition',
      capability: 'query food records',
      endpoint: 'POST eatings.xunjiapp.cn/open/food/query_gzip',
      tool: 'xunji_nutrition_query',
      scope: 'xunji:read',
      configured: hasFood,
      verified: false,
      status: hasFood ? 'ready' : 'unconfigured',
      notes: 'Needs a separate Xunji food key.',
    },
    {
      domain: 'nutrition',
      capability: 'search official foods',
      endpoint: 'POST api.xunjiapp.cn/open_agent/food/search_gzip',
      tool: 'xunji_search_foods',
      scope: 'xunji:read',
      configured: hasFoodSearch,
      verified: false,
      status: hasFoodSearch ? 'ready' : 'unconfigured',
      notes: 'Needs the separate food-search key from the official food skill.',
    },
    {
      domain: 'templates',
      capability: 'personal template sync/mutation',
      endpoint: 'POST trains.xunjiapp.cn/api_agent_templates_*',
      tool: null,
      scope: 'xunji:read',
      configured: false,
      verified: false,
      status: 'not_implemented',
      notes:
        'Mutating; requires a separate template key. Intentionally out of scope for the read-only bridge.',
    },
    {
      domain: 'training',
      capability: 'write/upsert training days',
      endpoint: 'POST trains.xunjiapp.cn/api_upsert_trains_for_llm_v2',
      tool: 'xunji_upsert_training_day',
      scope: 'xunji:write',
      configured: (env.WRITE_TOOLS_ENABLED ?? '').toLowerCase() === 'true',
      verified: false,
      status: (env.WRITE_TOOLS_ENABLED ?? '').toLowerCase() === 'true' ? 'ready' : 'disabled',
      notes:
        'Disabled by default. The vendor ignores dry_run, so this is a real write whenever enabled.',
    },
  ];
}

export function configuredDomains(env: Env): string[] {
  return [
    ...new Set(
      capabilityMatrix(env)
        .filter((row) => row.configured)
        .map((row) => row.domain),
    ),
  ];
}
