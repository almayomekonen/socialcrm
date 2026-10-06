import 'server-only'
import type { Knex } from 'knex'
import { db } from '@/config/db'
import type { McpPrincipal } from './scope'

/**
 * MCP rate limits — the repo's DB-count pattern, counted on mcp_audit_events
 * (every call writes one row). Scoped per grant (one user + one client) and per
 * agency; never global, so one tenant cannot exhaust another's budget.
 *
 * Message reads (get_conversation with includeMessages) have a stricter hourly
 * bucket, counted on successful reads only. Counting errors fail OPEN (logged),
 * like lib/mobile/rateLimit.ts: if the database cannot count, the tool call
 * cannot run either.
 */
export const RATE_LIMITS = {
  perGrantMinute: { windowSeconds: 60, max: 60 },
  perGrantDay: { windowSeconds: 86_400, max: 2_000 },
  messageReadsHour: { windowSeconds: 3_600, max: 120 },
  perAgencyDay: { windowSeconds: 86_400, max: 10_000 },
} as const

type Rule = { windowSeconds: number; max: number }
type Verdict = { ok: true } | { ok: false; retryAfterSeconds: number }

async function check(rule: Rule, scope: (q: Knex.QueryBuilder) => void): Promise<Verdict> {
  const q = db('mcp_audit_events').where('occurred_at', '>', db.raw('NOW() - make_interval(secs => ?)', [rule.windowSeconds]))
  scope(q)
  const row = (await q.first(
    db.raw('COUNT(*)::int AS n'),
    db.raw('CEIL(EXTRACT(EPOCH FROM (MIN(occurred_at) + make_interval(secs => ?) - NOW())))::int AS retry', [rule.windowSeconds]),
  )) as { n: number; retry: number | null }
  if (row.n < rule.max) return { ok: true }
  return { ok: false, retryAfterSeconds: Math.min(rule.windowSeconds, Math.max(1, row.retry ?? rule.windowSeconds)) }
}

export async function checkRateLimit(p: McpPrincipal, opts: { includeMessages?: boolean } = {}): Promise<Verdict> {
  try {
    const checks: [Rule, (q: Knex.QueryBuilder) => void][] = [
      [RATE_LIMITS.perGrantMinute, (q) => q.where('grant_id', p.grantId)],
      [RATE_LIMITS.perGrantDay, (q) => q.where('grant_id', p.grantId)],
      [RATE_LIMITS.perAgencyDay, (q) => q.where('agency_id', p.agencyId)],
    ]
    if (opts.includeMessages) {
      checks.push([
        RATE_LIMITS.messageReadsHour,
        (q) =>
          q
            .where('grant_id', p.grantId)
            .where('tool', 'get_conversation')
            .where('outcome', 'ok')
            .whereRaw(`params->>'includeMessages' = 'true'`),
      ])
    }
    for (const [rule, scope] of checks) {
      const v = await check(rule, scope)
      if (!v.ok) return v
    }
    return { ok: true }
  } catch (e) {
    console.error('[mcp/rate-limit] count failed; allowing', { requestId: p.requestId, error: (e as Error)?.name })
    return { ok: true }
  }
}
