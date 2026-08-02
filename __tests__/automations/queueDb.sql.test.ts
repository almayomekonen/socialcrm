import { describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import {
  claimAutomationJobsQuery,
  enqueueAutomationJobQuery,
  failAutomationJobQuery,
  pruneTerminalJobsQuery,
  reclaimStaleAutomationJobsQuery,
} from '@/db/automations/jobs'
import { claimSendOnceQuery, hasSendClaimQuery, releaseSendClaimQuery } from '@/db/automations/claims'

// SQL-shape tests (no live DB — the repo's `.toSQL()` pattern, see
// __tests__/today/facts.sql.test.ts). These pin the queue's storage contract:
// conflict-ignore enqueue behind an active-definition gate, SKIP LOCKED
// claims, lease reclaim, backoff-to-dead failures, and once-ever claims.

const T0 = new Date('2026-08-02T12:00:00Z')

const enqueueArgs = {
  agencyId: 7,
  automationId: 3,
  leadId: 42,
  trigger: 'lead_created' as const,
  origin: 'webhook_facebook' as const,
  eventKey: 'lead_created',
  notBefore: T0,
}

describe('automation_jobs queue shapes', () => {
  it('enqueue is conflict-ignore on the dedup key, gated on an active definition', () => {
    const { sql, bindings } = enqueueAutomationJobQuery(db, enqueueArgs).toSQL()
    const s = sql.toLowerCase()
    expect(s).toContain('insert into automation_jobs')
    expect(s).toContain('on conflict ("automationid","leadid","eventkey") do nothing')
    expect(s).toContain(`d.status = 'active'`)
    expect(bindings).toContain(7)
    expect(bindings).toContain('webhook_facebook')
    expect(bindings).toContain(T0)
  })

  it('claim uses FOR UPDATE SKIP LOCKED over due pending jobs, bounded by limit', () => {
    const { sql, bindings } = claimAutomationJobsQuery('worker-1', 5).toSQL()
    const s = sql.toLowerCase()
    expect(s).toContain(`status = 'pending'`)
    expect(s).toContain('"notbefore" <= now()')
    expect(s).toContain('for update skip locked')
    expect(s).toContain(`set status = 'processing'`)
    expect(bindings).toEqual(['worker-1', 5])
  })

  it('reclaim frees only expired processing leases', () => {
    const cutoff = new Date(T0.getTime() - 60_000)
    const { sql, bindings } = reclaimStaleAutomationJobsQuery(cutoff).toSQL()
    const s = sql.toLowerCase()
    expect(s).toContain(`status = 'processing'`)
    expect(s).toContain('"lockedat" <')
    expect(s).toContain(`set status = 'pending'`)
    expect(bindings).toEqual([cutoff])
  })

  it('failure retries with backoff and dead-letters at maxAttempts', () => {
    const { sql } = failAutomationJobQuery(9, 'boom').toSQL()
    const s = sql.toLowerCase()
    expect(s).toContain(`when attempts >= "maxattempts" then 'dead'`)
    expect(s).toContain(`else 'pending'`)
    expect(s).toContain(`interval '30 seconds'`)
  })

  it('prune touches only terminal statuses before the cutoff', () => {
    const cutoff = new Date('2026-05-01T00:00:00Z')
    const { sql, bindings } = pruneTerminalJobsQuery(cutoff).toSQL()
    const s = sql.toLowerCase()
    expect(s).toContain(`status in ('done','skipped','dead')`)
    expect(s).toContain('"updatedat" <')
    expect(bindings).toEqual([cutoff])
  })
})

describe('automation_send_claims shapes (ADR-005/ADR-009)', () => {
  it('claim is conflict-ignore on the once-ever key and records the consuming mode', () => {
    const { sql, bindings } = claimSendOnceQuery({ agencyId: 7, automationId: 3, leadId: 42, mode: 'log' }).toSQL()
    const s = sql.toLowerCase()
    expect(s).toContain('insert into automation_send_claims')
    expect(s).toContain(`'ever'`)
    expect(s).toContain('on conflict ("automationid","leadid",semantics) do nothing')
    expect(bindings).toContain('log')
  })

  it('release deletes ONLY unconfirmed claims — a confirmed claim is permanent', () => {
    const { sql, bindings } = releaseSendClaimQuery(3, 42).toSQL()
    const s = sql.toLowerCase()
    expect(s).toContain('delete from "automation_send_claims"')
    expect(s).toContain('"status" =')
    expect(bindings).toContain('claimed')
  })

  it('claim lookup keys on (automation, lead, semantics)', () => {
    const { sql, bindings } = hasSendClaimQuery(3, 42).toSQL()
    const s = sql.toLowerCase()
    expect(s).toContain('"automationid" =')
    expect(s).toContain('"leadid" =')
    expect(bindings).toContain('ever')
  })
})
