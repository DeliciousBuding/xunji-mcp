/**
 * Operator identity gate for the authorization endpoint.
 *
 * The bridge serves exactly one operator's Xunji account. Authorization is
 * therefore not self-service: the person approving an OAuth client must prove
 * they are the allowlisted operator before a grant is created.
 *
 * Two deployment modes, both fail-closed:
 *
 * 1. `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` (recommended): the `/authorize` path is
 *    placed behind Cloudflare Access. Access injects a signed
 *    `Cf-Access-Jwt-Assertion`; we verify its signature against the team's
 *    JWKS, check issuer/audience/expiry, then require the email to appear in
 *    `ALLOWED_USER_EMAILS`. Identity comes from the identity provider, not from
 *    anything the caller asserts.
 *
 * 2. `OWNER_PASSPHRASE`: a high-entropy deployment secret typed into the
 *    consent form. Used only when Access is not configured, e.g. self-hosting
 *    outside Cloudflare. Comparison is constant-time over SHA-256 digests.
 *
 * If neither is configured, every authorization request is refused. There is
 * deliberately no "allow everyone" switch.
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';

import type { Env } from '../types';

export interface OperatorIdentity {
  /** Stable non-reversible subject used for token props and cache keys. */
  subject: string;
  /** Human label, safe to show in logs/pages. Never the upstream key. */
  label: string;
  /** Email when known. */
  email?: string;
  method: 'cf-access' | 'passphrase';
}

function allowlist(env: Env): string[] {
  return (env.ALLOWED_USER_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function accessConfigured(env: Env): boolean {
  return Boolean(env.ACCESS_TEAM_DOMAIN?.trim() && env.ACCESS_AUD?.trim());
}

export function passphraseConfigured(env: Env): boolean {
  return Boolean(env.OWNER_PASSPHRASE?.trim());
}

export async function subjectFor(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`xunji-mcp:${value}`));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

function labelFor(email: string): string {
  const local = email.split('@')[0] ?? 'operator';
  return local.replace(/[^a-z0-9._-]/gi, '') || 'operator';
}

/** Verifies a Cloudflare Access JWT and applies the email allowlist. */
export async function identityFromAccess(
  request: Request,
  env: Env,
): Promise<OperatorIdentity | null> {
  if (!accessConfigured(env)) return null;
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return null;

  const team = env.ACCESS_TEAM_DOMAIN!.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const issuer = `https://${team}`;
  try {
    const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: env.ACCESS_AUD!.trim(),
      algorithms: ['RS256'],
    });
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    if (!email) return null;
    const allowed = allowlist(env);
    if (allowed.length === 0 || !allowed.includes(email)) return null;
    return {
      subject: await subjectFor(email),
      label: labelFor(email),
      email,
      method: 'cf-access',
    };
  } catch {
    return null;
  }
}

/** Constant-time comparison of two secret strings via SHA-256 digests. */
export async function secretsMatch(candidate: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(`xunji-mcp:passphrase:${candidate}`)),
    crypto.subtle.digest('SHA-256', encoder.encode(`xunji-mcp:passphrase:${expected}`)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

/**
 * Passphrase mode needs no allowlist entry: possession of the deployment secret
 * *is* the allowlist. A configured allowlist still narrows the label.
 */
export async function identityFromPassphrase(
  candidate: string,
  env: Env,
): Promise<OperatorIdentity | null> {
  const expected = env.OWNER_PASSPHRASE?.trim();
  if (!expected) return null;
  if (!(await secretsMatch(candidate, expected))) return null;
  const email = allowlist(env)[0];
  const key = email ?? 'owner';
  return {
    subject: await subjectFor(key),
    label: labelFor(email ?? 'owner'),
    ...(email ? { email } : {}),
    method: 'passphrase',
  };
}

export function identityMode(env: Env): 'cf-access' | 'passphrase' | 'none' {
  if (accessConfigured(env)) return 'cf-access';
  if (passphraseConfigured(env)) return 'passphrase';
  return 'none';
}