import { describe, it, expect } from 'vitest'
import { applyTemplateUpdates } from '@/modules/templates/client/applyTemplateUpdates'
import type { Template } from '@/lib/whatsapp/templates/types'

const t = (id: number, status: Template['status'], failureText: string | null = null): Template => ({
  id,
  displayTitle: 'x',
  status,
  bodyText: 'b',
  variables: [],
  failureText,
  archived: false,
  createdAt: '2026-07-23T00:00:00Z',
})

describe('applyTemplateUpdates', () => {
  it('converges a pending row to its server status', () => {
    const prev = [t(1, 'pending')]
    const next = applyTemplateUpdates(prev, [t(1, 'approved')])
    expect(next[0].status).toBe('approved')
    expect(next).not.toBe(prev)
  })

  it('carries failureText through for a rejection', () => {
    const next = applyTemplateUpdates([t(1, 'pending')], [t(1, 'rejected', 'לא אושרה')])
    expect(next[0]).toMatchObject({ status: 'rejected', failureText: 'לא אושרה' })
  })

  it('returns the SAME reference when nothing changed', () => {
    const prev = [t(1, 'approved')]
    expect(applyTemplateUpdates(prev, [t(1, 'approved')])).toBe(prev)
  })

  it('leaves an un-reconciled optimistic row (negative id, absent from server) untouched', () => {
    const prev = [t(-123, 'pending'), t(1, 'pending')]
    const next = applyTemplateUpdates(prev, [t(1, 'approved')])
    expect(next.find((x) => x.id === -123)?.status).toBe('pending') // optimistic preserved
    expect(next.find((x) => x.id === 1)?.status).toBe('approved')
  })

  it('never adds or removes rows (update-only)', () => {
    const prev = [t(1, 'pending')]
    const next = applyTemplateUpdates(prev, [t(1, 'approved'), t(2, 'approved')])
    expect(next).toHaveLength(1) // id 2 not added
  })

  it('empty incoming → same reference', () => {
    const prev = [t(1, 'pending')]
    expect(applyTemplateUpdates(prev, [])).toBe(prev)
  })
})
