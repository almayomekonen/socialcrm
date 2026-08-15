import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireProductAccess = vi.hoisted(() => vi.fn())
const loadOwned = vi.hoisted(() => vi.fn())
const findMatches = vi.hoisted(() => vi.fn())
const upsertLead = vi.hoisted(() => vi.fn())
const attach = vi.hoisted(() => vi.fn())
const enqueue = vi.hoisted(() => vi.fn())
const clientsFirst = vi.hoisted(() => vi.fn())
const personalUpdate = vi.hoisted(() => vi.fn())

vi.mock('@/lib/requireUser', () => ({
  requireProductAccess,
}))
vi.mock('@/lib/whatsapp/ownedConversation', () => ({
  loadOwnedConversation: loadOwned,
}))
vi.mock('@/lib/whatsapp/matchLeadByPhone', () => ({
  findClientsByPhoneCore: findMatches,
}))
vi.mock('@/actions/clients', () => ({
  upsertLead,
}))
vi.mock('@/db/inboxConversations', () => ({
  attachConversationToLead: attach,
}))
vi.mock('@/db/conversationIntelligence', () => ({
  enqueueConversationAnalysis: enqueue,
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/config/db', () => ({
  db: Object.assign(
    (table: string) => {
      if (table === 'clients') {
        return { where: () => ({ first: (...a: unknown[]) => clientsFirst(...a) }) }
      }
      if (table === 'inbox_conversations') {
        return {
          where: () => ({
            whereNull: () => ({ update: (...a: unknown[]) => personalUpdate(...a) }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
    {
      transaction: async (fn: (trx: unknown) => Promise<unknown>) => fn({}),
    },
  ),
}))

const { promoteConversationToLead, linkConversationToExistingLead } = await import(
  '@/actions/whatsapp/promoteConversationToLead'
)
const { markConversationPersonal } = await import('@/actions/whatsapp/markConversationPersonal')

const USER = { id: 3, agencyId: 69 }

beforeEach(() => {
  requireProductAccess.mockReset()
  requireProductAccess.mockResolvedValue(USER)
  loadOwned.mockReset()
  findMatches.mockReset()
  upsertLead.mockReset()
  attach.mockReset()
  enqueue.mockReset()
  clientsFirst.mockReset()
  personalUpdate.mockReset()
})

describe('promote / link / personal — agency isolation', () => {
  it('promote returns not-found when the conversation is not in the session agency', async () => {
    loadOwned.mockResolvedValue(null)
    const res = await promoteConversationToLead(99)
    expect(res).toEqual({ ok: false, reason: 'not-found' })
    expect(upsertLead).not.toHaveBeenCalled()
    expect(attach).not.toHaveBeenCalled()
  })

  it('link rejects a lead that is not in the session agency', async () => {
    loadOwned.mockResolvedValue({
      id: 9,
      agencyId: 69,
      leadId: null,
      isPersonal: false,
      customerWaId: '972501111111',
      customerName: 'Dana',
      channel: 'whatsapp',
    })
    clientsFirst.mockResolvedValue(undefined)
    const res = await linkConversationToExistingLead(9, 404)
    expect(res).toEqual({ ok: false, reason: 'lead-not-found' })
    expect(attach).not.toHaveBeenCalled()
  })

  it('promote is idempotent when already linked', async () => {
    loadOwned.mockResolvedValue({
      id: 9,
      agencyId: 69,
      leadId: 12,
      isPersonal: false,
      customerWaId: '972501111111',
      customerName: 'Dana',
      channel: 'whatsapp',
    })
    const res = await promoteConversationToLead(9)
    expect(res).toEqual({ ok: true, leadId: 12, created: false })
    expect(upsertLead).not.toHaveBeenCalled()
  })

  it('promote links instead of creating when the phone uniquely matches', async () => {
    loadOwned.mockResolvedValue({
      id: 9,
      agencyId: 69,
      leadId: null,
      isPersonal: false,
      customerWaId: '972501111111',
      customerName: 'Dana',
      channel: 'whatsapp',
    })
    findMatches.mockResolvedValue([{ id: 77, name: 'דנה', status: 'new', phone: '972501111111' }])
    const res = await promoteConversationToLead(9)
    expect(res).toEqual({ ok: true, leadId: 77, created: false })
    expect(upsertLead).not.toHaveBeenCalled()
    expect(attach).toHaveBeenCalled()
  })

  it('mark personal refuses a conversation from another agency', async () => {
    loadOwned.mockResolvedValue(null)
    const res = await markConversationPersonal(99)
    expect(res).toEqual({ ok: false, reason: 'not-found' })
    expect(personalUpdate).not.toHaveBeenCalled()
  })

  it('mark personal refuses a conversation that is already a lead', async () => {
    loadOwned.mockResolvedValue({
      id: 9,
      agencyId: 69,
      leadId: 12,
      isPersonal: false,
      customerWaId: '972501111111',
      customerName: 'Dana',
      channel: 'whatsapp',
    })
    const res = await markConversationPersonal(9)
    expect(res).toEqual({ ok: false, reason: 'already-linked' })
  })
})
