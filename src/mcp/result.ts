/** Shared MCP result helpers. */

import { UpstreamError } from '../upstream/client';
import { IndexUnavailableError, QueryError } from '../index/query';

export function jsonResult(payload: Record<string, unknown>, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
    ...(isError ? { isError: true } : {}),
  };
}

/**
 * For large analytic results: the structured payload carries the data, the text
 * block stays a short human summary instead of duplicating the same JSON.
 */
export function compactResult(payload: Record<string, unknown>, summary: string) {
  return {
    content: [{ type: 'text' as const, text: summary }],
    structuredContent: payload,
  };
}

export interface Failure {
  code: string;
  message: string;
  retryAfterSeconds?: number;
}

export function failurePayload(error: unknown): Failure {
  if (error instanceof QueryError) return { code: error.code, message: error.message };
  if (error instanceof IndexUnavailableError)
    return { code: 'index_unavailable', message: error.message };
  if (error instanceof UpstreamError) {
    const payload: Failure = { code: error.code, message: error.message };
    if (error.retryAfterSeconds !== undefined) payload.retryAfterSeconds = error.retryAfterSeconds;
    return payload;
  }
  return { code: 'internal_error', message: 'The bridge could not complete this request.' };
}
