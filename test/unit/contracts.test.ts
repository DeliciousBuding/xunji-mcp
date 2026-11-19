import { describe, expect, it } from 'vitest';

import { classifyFailure, parseRetryAfterSeconds, UpstreamError } from '../../src/upstream/client';
import { enumerateDates } from '../../src/service/day-read';
import { secretsMatch, subjectFor } from '../../src/auth/identity';

describe('classifyFailure', () => {
  it('maps the vendor soft rate-limit string to a retry hint', () => {
    const error = classifyFailure('too frequent, retry after 30s');
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error.code).toBe('rate_limited');
    expect(error.retryAfterSeconds).toBe(30);
  });

  it('maps an invalid key without echoing it', () => {
    const error = classifyFailure('apikey invalid');
    expect(error.code).toBe('unauthorized');
    expect(error.message).not.toContain('apikey');
  });

  it('maps membership gating', () => {
    const error = classifyFailure('仅VIP可用');
    expect(error.code).toBe('vip_required');
  });

  it('does not echo unknown vendor text', () => {
    const error = classifyFailure('some internal detail <html>');
    expect(error.code).toBe('upstream_unavailable');
    expect(error.message).not.toContain('html');
  });
});

describe('parseRetryAfterSeconds', () => {
  it('accepts the documented phrasing and rejects noise', () => {
    expect(parseRetryAfterSeconds('too frequent, retry after 15s')).toBe(15);
    expect(parseRetryAfterSeconds('retry after 0s')).toBe(0);
    expect(parseRetryAfterSeconds('nope')).toBeUndefined();
  });
});

describe('enumerateDates', () => {
  it('includes both endpoints', () => {
    expect(enumerateDates('2026-11-16', '2026-11-18')).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
    ]);
  });

  it('returns empty for inverted or malformed ranges', () => {
    expect(enumerateDates('2026-11-18', '2026-11-16')).toEqual([]);
    expect(enumerateDates('not-a-date', '2026-11-18')).toEqual([]);
  });
});

describe('identity helpers', () => {
  it('produces a stable, non-reversible subject', async () => {
    const a = await subjectFor('operator@example.com');
    const b = await subjectFor('operator@example.com');
    expect(a).toBe(b);
    expect(a).toHaveLength(32);
    expect(a).not.toContain('operator');
  });

  it('compares secrets without leaking length-dependent timing', async () => {
    expect(await secretsMatch('correct horse', 'correct horse')).toBe(true);
    expect(await secretsMatch('correct hors', 'correct horse')).toBe(false);
    expect(await secretsMatch('', 'correct horse')).toBe(false);
  });
});
