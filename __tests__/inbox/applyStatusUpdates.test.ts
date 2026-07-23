import { describe, it, expect } from 'vitest'
import { applyStatusesToMessages } from '@/modules/inbox/client/applyStatusUpdates'
import type { LeadWhatsappMessage } from '@/db/inboxMessages'

const msg = (id: number, status: LeadWhatsappMessage['status']): LeadWhatsappMessage => ({
  id,
  direction: 'outbound',
  type: 'text',
  text: 'x',
  timestamp: '2026-07-22T12:00:00.000Z',
  status,
  failureText: null,
})

describe('applyStatusesToMessages', () => {
  it('updates the matching message', () => {
    const prev = [msg(1, 'sent'), msg(2, 'sent')]
    const next = applyStatusesToMessages(prev, [{ id: 2, status: 'delivered', failureText: null }])
    expect(next[1].status).toBe('delivered')
    expect(next[0].status).toBe('sent')
  })

  it('returns the SAME array reference when nothing changed (prevents a re-render every poll)', () => {
    const prev = [msg(1, 'sent')]
    const next = applyStatusesToMessages(prev, [{ id: 1, status: 'sent', failureText: null }])
    expect(next).toBe(prev)
  })

  it('ignores ids not present in the thread', () => {
    const prev = [msg(1, 'sent')]
    const next = applyStatusesToMessages(prev, [{ id: 99, status: 'read', failureText: null }])
    expect(next).toBe(prev)
  })

  it('carries failureText through', () => {
    const prev = [msg(1, 'sent')]
    const next = applyStatusesToMessages(prev, [{ id: 1, status: 'failed', failureText: 'לא נשלח' }])
    expect(next[0].failureText).toBe('לא נשלח')
    expect(next[0].status).toBe('failed')
  })

  it('detects a failureText-only change', () => {
    const prev = [{ ...msg(1, 'failed'), failureText: 'ישן' }]
    const next = applyStatusesToMessages(prev, [{ id: 1, status: 'failed', failureText: 'חדש' }])
    expect(next).not.toBe(prev)
    expect(next[0].failureText).toBe('חדש')
  })

  it('empty updates is a no-op', () => {
    const prev = [msg(1, 'sent')]
    expect(applyStatusesToMessages(prev, [])).toBe(prev)
  })

  it('does not mutate the input array', () => {
    const prev = [msg(1, 'sent')]
    applyStatusesToMessages(prev, [{ id: 1, status: 'read', failureText: null }])
    expect(prev[0].status).toBe('sent')
  })
})
