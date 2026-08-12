/**
 * Task 3B — reconcile is createOrigin-safe and uses emitLeadCreated.
 *
 * Candidate selection (SQL) excludes import + legacy NULL.
 * Emission always goes through emitLeadCreated({ origin: 'reconcile' }) —
 * import silence is not re-implemented in the reconcile loop.
 *
 * Runs under VITEST_NO_DB=1 (`npm run test:notifications`).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RECONCILE_WINDOW_MINUTES, RECONCILE_LIMIT } from '@/db/notifications/reconcile'

const findLeadsMissingCreatedJob = vi.fn()
const emitLeadCreated = vi.fn()
const isNotificationsEnabled = vi.fn()
const notifyEvent = vi.fn()

vi.mock('@/db/notifications/reconcile', async () => {
  const actual = await vi.importActual<typeof import('@/db/notifications/reconcile')>(
    '@/db/notifications/reconcile',
  )
  return {
    ...actual,
    findLeadsMissingCreatedJob: (...args: unknown[]) => findLeadsMissingCreatedJob(...args),
  }
})

vi.mock('@/lib/notifications/emitLeadCreated', async () => {
  const actual = await vi.importActual<typeof import('@/lib/notifications/emitLeadCreated')>(
    '@/lib/notifications/emitLeadCreated',
  )
  return {
    ...actual,
    emitLeadCreated: (...args: unknown[]) => emitLeadCreated(...args),
  }
})

vi.mock('@/lib/notifications/flags', () => ({
  isNotificationsEnabled: (...args: unknown[]) => isNotificationsEnabled(...args),
}))

vi.mock('@/lib/notifications/emit', () => ({
  notifyEvent: (...args: unknown[]) => notifyEvent(...args),
}))

const { reconcileMissedLeadCreated } = await import('@/lib/notifications/reconcile')
const { findLeadsMissingCreatedJobQuery } = await import('@/db/notifications/reconcile')
const { shouldEmitLeadCreated } = await import('@/lib/notifications/emitLeadCreated')

beforeEach(() => {
  findLeadsMissingCreatedJob.mockReset()
  emitLeadCreated.mockReset()
  isNotificationsEnabled.mockReset()
  notifyEvent.mockReset()
  isNotificationsEnabled.mockReturnValue(true)
  findLeadsMissingCreatedJob.mockResolvedValue([])
  emitLeadCreated.mockResolvedValue({ enqueued: true, skipped: null })
})

describe('reconcile candidate SQL — createOrigin eligibility', () => {
  function sqlLower() {
    const { sql } = findLeadsMissingCreatedJobQuery(RECONCILE_WINDOW_MINUTES, RECONCILE_LIMIT).toSQL()
    return sql.toLowerCase()
  }

  it('excludes import and NULL createOrigin; keeps window/limit/job NOT EXISTS', () => {
    const lower = sqlLower()
    expect(lower).toContain('c.lead = true')
    expect(lower).toContain('c."createorigin" is not null')
    expect(lower).toMatch(/c\."createorigin"\s*<>\s*'import'/)
    expect(lower).toContain(`j.type = 'lead.created'`)
    expect(lower).toContain('interval')
    expect(lower).not.toContain('leadsource')
    expect(lower).not.toContain('automation_')
  })

  it('preserves the fixed 30-minute / 200 durability figures', () => {
    expect(RECONCILE_WINDOW_MINUTES).toBe(30)
    expect(RECONCILE_LIMIT).toBe(200)
  })
})

describe('reconcileMissedLeadCreated → emitLeadCreated', () => {
  it('does not call notifyEvent directly; uses emitLeadCreated(origin: reconcile)', async () => {
    findLeadsMissingCreatedJob.mockResolvedValue([
      { id: 11, agencyId: 7, firstName: 'דני', lastName: 'כהן' },
    ])

    const summary = await reconcileMissedLeadCreated()

    expect(notifyEvent).not.toHaveBeenCalled()
    expect(emitLeadCreated).toHaveBeenCalledTimes(1)
    expect(emitLeadCreated.mock.calls[0][0]).toMatchObject({
      agencyId: 7,
      leadId: 11,
      actorUserId: null,
      origin: 'reconcile',
      leadName: 'דני כהן',
    })
    expect(summary).toEqual({ scanned: 1, enqueued: 1, skipped: 0 })
  })

  it('emits for manual / facebook / whatsapp / cf7 candidates (selection already filtered)', async () => {
    findLeadsMissingCreatedJob.mockResolvedValue([
      { id: 1, agencyId: 7, firstName: 'M', lastName: null },
      { id: 2, agencyId: 7, firstName: 'F', lastName: null },
      { id: 3, agencyId: 7, firstName: 'W', lastName: null },
      { id: 4, agencyId: 7, firstName: 'C', lastName: null },
    ])

    await reconcileMissedLeadCreated()

    expect(emitLeadCreated).toHaveBeenCalledTimes(4)
    for (const call of emitLeadCreated.mock.calls) {
      expect(call[0].origin).toBe('reconcile')
      expect(shouldEmitLeadCreated(call[0].origin)).toBe(true)
    }
  })

  it('import is silent at the emit door; reconcile never reimplements that check for candidates', async () => {
    // Selection must not return import rows. If a row is returned, reconcile still
    // uses origin='reconcile' (eligible) — import silence lives in SQL + shouldEmitLeadCreated('import').
    expect(shouldEmitLeadCreated('import')).toBe(false)
    expect(shouldEmitLeadCreated('reconcile')).toBe(true)

    findLeadsMissingCreatedJob.mockResolvedValue([])
    await reconcileMissedLeadCreated()
    expect(emitLeadCreated).not.toHaveBeenCalled()
  })

  it('existing job / duplicate enqueue is counted skipped (idempotent)', async () => {
    findLeadsMissingCreatedJob.mockResolvedValue([
      { id: 42, agencyId: 7, firstName: 'A', lastName: null },
    ])
    emitLeadCreated.mockResolvedValue({ enqueued: false, skipped: 'duplicate' })

    const summary = await reconcileMissedLeadCreated()
    expect(summary).toEqual({ scanned: 1, enqueued: 0, skipped: 1 })
  })

  it('repeated reconcile on the same candidate stays idempotent via emitLeadCreated', async () => {
    const row = { id: 42, agencyId: 7, firstName: 'A', lastName: null }
    findLeadsMissingCreatedJob.mockResolvedValue([row])
    emitLeadCreated
      .mockResolvedValueOnce({ enqueued: true, skipped: null })
      .mockResolvedValueOnce({ enqueued: false, skipped: 'duplicate' })

    expect(await reconcileMissedLeadCreated()).toMatchObject({ enqueued: 1, skipped: 0 })
    expect(await reconcileMissedLeadCreated()).toMatchObject({ enqueued: 0, skipped: 1 })
    expect(emitLeadCreated).toHaveBeenCalledTimes(2)
    expect(emitLeadCreated.mock.calls[0][0].leadId).toBe(42)
    expect(emitLeadCreated.mock.calls[1][0].leadId).toBe(42)
  })

  it('passes the existing window/limit defaults through to the reader', async () => {
    await reconcileMissedLeadCreated()
    expect(findLeadsMissingCreatedJob).toHaveBeenCalledWith(30, 200)

    await reconcileMissedLeadCreated({ windowMinutes: 30, limit: 50 })
    expect(findLeadsMissingCreatedJob).toHaveBeenLastCalledWith(30, 50)
  })
})
