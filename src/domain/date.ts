/**
 * Calendar-date helpers.
 *
 * Xunji stores a training day as a calendar date in the account's local day
 * boundary; the API neither accepts nor returns a timezone. This bridge does
 * not reinterpret dates. "Today" is evaluated in the vendor's home timezone so
 * cache freshness and default plan windows do not flip a day early or late.
 */

export const XUNJI_TIMEZONE = 'Asia/Shanghai';

export function todayInXunjiZone(now = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: XUNJI_TIMEZONE }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function addDays(datestr: string, days: number): string {
  const parsed = new Date(`${datestr}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return datestr;
  return new Date(parsed.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}
