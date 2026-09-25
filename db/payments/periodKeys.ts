/**
 * A charge "period" identifies WHAT is being paid for, so one period can never
 * succeed twice (partial unique index) and retries share Grow's group identifier.
 *
 *   trial_end                   the first charge after the card-required trial
 *   renewal:<expiresAt, UTC s>  the period that starts when that expiry passes
 *
 * The SQL and JS renderings MUST agree (pinned by charges.db.test.ts).
 */

export const TRIAL_END_PERIOD_KEY = 'trial_end'

export function renewalPeriodKey(expiresAt: Date): string {
  return `renewal:${expiresAt.toISOString().slice(0, 19)}Z`
}

export function renewalPeriodKeySql(alias: string): string {
  return `('renewal:' || to_char(${alias}."expiresAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))`
}
