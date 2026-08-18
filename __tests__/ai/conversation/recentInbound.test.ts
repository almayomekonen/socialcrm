import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/copilot/general/waitingInbound', () => ({
  listWaitingWhatsappRows: vi.fn(),
  listWaitingWhatsappLeads: vi.fn(),
}))
vi.mock('@/lib/copilot/general/recentInboundQuery', () => ({
  listRecentWhatsappInboundRows: vi.fn(),
  recentWhatsappInboundQuery: vi.fn(),
}))

import { listWaitingWhatsappRows } from '@/lib/copilot/general/waitingInbound'
import { listRecentWhatsappInboundRows } from '@/lib/copilot/general/recentInboundQuery'
import { loadRecentInboundWhatsapp, loadWaitingInboundWhatsapp } from '@/lib/copilot/general/recentInbound'
import { Roles } from '@/types/roles'

const user = { agencyId: 10, id: 1, role: Roles.ADMIN }
const scope = { user: { role: Roles.ADMIN }, gotPermIds: [1] }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('loadRecentInboundWhatsapp', () => {
  it('lists recent inbound including an already-answered sender, without waiting copy', async () => {
    vi.mocked(listRecentWhatsappInboundRows).mockResolvedValue([
      { id: 9, name: 'דנה', status: 'new', lastInboundAt: '2026-08-18T13:17:00.000Z' },
      { id: 1, name: 'George', status: 'new', lastInboundAt: '2026-08-18T13:01:00.000Z' },
    ])
    const payload = await loadRecentInboundWhatsapp(user, scope)
    expect(listWaitingWhatsappRows).not.toHaveBeenCalled()
    expect(listRecentWhatsappInboundRows).toHaveBeenCalledWith(user, scope)
    expect(payload.senders.map((s) => s.name)).toEqual(['דנה', 'George'])
    expect(payload.answer).toContain('דנה')
    expect(payload.answer).toContain('מי ששלח הודעה בוואטסאפ לאחרונה')
    expect(payload.answer).not.toContain('ממתין')
    expect(payload.answer).not.toMatch(/callback/i)
  })
})

describe('loadWaitingInboundWhatsapp', () => {
  it('uses waiting-reply rows and waiting copy, and can omit an answered recent sender', async () => {
    vi.mocked(listWaitingWhatsappRows).mockResolvedValue([
      { id: 1, name: 'George', status: 'new', lastInboundAt: '2026-08-18T13:01:00.000Z' },
    ])
    const payload = await loadWaitingInboundWhatsapp(user, scope)
    expect(listWaitingWhatsappRows).toHaveBeenCalledWith(user, scope, 'asc')
    expect(payload.senders.map((s) => s.name)).toEqual(['George'])
    expect(payload.answer).toContain('מי שממתין למענה בוואטסאפ')
    expect(payload.answer).not.toContain('דנה')
    expect(payload.answer).not.toContain('מי ששלח הודעה בוואטסאפ לאחרונה')
  })
})

describe('recent vs waiting vs unread', () => {
  it('recent and waiting can return different people', async () => {
    vi.mocked(listRecentWhatsappInboundRows).mockResolvedValue([
      { id: 9, name: 'דנה', status: 'new', lastInboundAt: '2026-08-18T13:17:00.000Z' },
      { id: 1, name: 'George', status: 'new', lastInboundAt: '2026-08-18T13:01:00.000Z' },
    ])
    vi.mocked(listWaitingWhatsappRows).mockResolvedValue([
      { id: 1, name: 'George', status: 'new', lastInboundAt: '2026-08-18T13:01:00.000Z' },
    ])
    const recent = await loadRecentInboundWhatsapp(user, scope)
    const waiting = await loadWaitingInboundWhatsapp(user, scope)
    expect(recent.senders.map((s) => s.name)).toContain('דנה')
    expect(waiting.senders.map((s) => s.name)).not.toContain('דנה')
    expect(waiting.senders.map((s) => s.name)).toContain('George')
  })
})
