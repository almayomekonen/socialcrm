import type { BudgetPolicy } from './policy'

/**
 * The budget scopes one reservation counts against — pure. A scope whose
 * identity is unknown is SKIPPED and named in `skipped`, never replaced by a
 * fresh per-call identity: a per-call "run" would make every retry, fallback
 * and step its own unlimited run.
 *
 * Counters are taken in this sorted order by the store, so concurrent
 * reservations lock them in the same order.
 */

export type ScopeInput = {
  policy: BudgetPolicy
  agencyId: number | null
  /** The logical run: a job, a router invocation, an Agent investigation. */
  operationKind: string
  operationId: string | null
  conversationId: number | null
  contactKey: string | null
  now: Date
}

const RUN_EPOCH = new Date(0)

export type Scope = {
  name: string
  key: string
  kind: 'run' | 'hour' | 'day' | 'period' | 'contact_window'
  start: Date
  limit: number | null
}

const utcHour = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()))
const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
const utcMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
/** Fixed buckets of `hours` (an approximation of a rolling window, stable across instances). */
const bucket = (d: Date, hours: number) => new Date(Math.floor(d.getTime() / (hours * 3_600_000)) * hours * 3_600_000)

export function scopesFor(i: ScopeInput): { scopes: Scope[]; skipped: string[] } {
  const p = i.policy
  const a = i.agencyId
  const scopes: Scope[] = []
  const skipped: string[] = []
  // The run is the logical operation (a job, a router invocation, an Agent
  // investigation) — never this one provider call, which would make every
  // retry, fallback and step its own unlimited "run".
  if (i.operationId)
    scopes.push({
      name: 'run',
      key: `run:a${a ?? '-'}:${i.operationKind}:${i.operationId}`,
      kind: 'run',
      start: RUN_EPOCH,
      limit: p.perRunUsd,
    })
  else skipped.push('run')
  if (i.conversationId != null)
    scopes.push({
      name: 'conversation_daily',
      key: `conv:a${a ?? '-'}:${i.conversationId}`,
      kind: 'day',
      start: utcDay(i.now),
      limit: p.conversationDailyUsd,
    })
  else skipped.push('conversation')
  if (i.contactKey)
    scopes.push({
      name: 'contact_window',
      key: `contact:${i.contactKey}`,
      kind: 'contact_window',
      start: bucket(i.now, Math.max(1, p.contactWindowHours)),
      limit: p.contactWindowUsd,
    })
  else skipped.push('contact')
  if (a != null) {
    scopes.push({ name: 'agency_hourly', key: `agency:${a}`, kind: 'hour', start: utcHour(i.now), limit: p.agencyHourlyUsd })
    scopes.push({ name: 'agency_daily', key: `agency:${a}`, kind: 'day', start: utcDay(i.now), limit: p.agencyDailyUsd })
    scopes.push({ name: 'agency_period', key: `agency:${a}`, kind: 'period', start: utcMonth(i.now), limit: p.agencyPeriodUsd })
  } else skipped.push('agency')
  scopes.push({ name: 'global_daily', key: 'global', kind: 'day', start: utcDay(i.now), limit: p.globalDailyUsd })
  scopes.sort((x, y) => (x.key + x.kind < y.key + y.kind ? -1 : 1))
  return { scopes, skipped }
}

export const scopeRef = (s: Scope) => `${s.key}|${s.kind}|${s.start.toISOString()}`
