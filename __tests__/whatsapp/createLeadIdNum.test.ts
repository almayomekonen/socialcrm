import { beforeEach, describe, expect, it, vi } from 'vitest'

const insertLeadSystem = vi.hoisted(() => vi.fn())
const first = vi.hoisted(() => vi.fn())

vi.mock('@/lib/system/insertLeadSystem', () => ({
  insertLeadSystem,
}))
vi.mock('@/lib/system/createSystemTask', () => ({ createSystemTask: vi.fn() }))
vi.mock('@/lib/quota', () => ({
  getQuotaStatus: vi.fn(async () => ({ plan: 'pro', limit: null, used: 0 })),
}))
vi.mock('@/lib/analytics/track', () => ({ trackFirstRealLeadOnce: vi.fn() }))
vi.mock('@/lib/automations/emit', () => ({ emitAutomationEvent: vi.fn() }))
vi.mock('@/lib/notifications/emitLeadCreated', () => ({ emitLeadCreated: vi.fn() }))
vi.mock('@/config/db', () => ({
  db: (table: string) => {
    if (table !== 'clients') throw new Error(table)
    return { where: () => ({ first: (...a: unknown[]) => first(...a) }) }
  },
}))

const { createLeadFromWhatsappWebhook } = await import('@/lib/system/createLeadFromWhatsappWebhook')

beforeEach(() => {
  first.mockReset()
  first.mockResolvedValue(undefined)
  insertLeadSystem.mockReset()
  insertLeadSystem.mockResolvedValue({ id: 1, leadSource: 'whatsapp:wamid.X' })
})

describe('createLeadFromWhatsappWebhook idNum', () => {
  it('inserts idNum=null so LPAD cannot collide on WA_ prefixes', async () => {
    await createLeadFromWhatsappWebhook({
      firstName: 'Dana',
      lastName: '',
      phone: '972501111111',
      messageId: 'wamid.VERY_LONG_ID',
      agencyId: 69,
      userId: 3,
    })
    expect(insertLeadSystem).toHaveBeenCalledTimes(1)
    expect(insertLeadSystem.mock.calls[0][0].idNum).toBeNull()
    expect(insertLeadSystem.mock.calls[0][0].createOrigin).toBe('whatsapp')
  })
})
