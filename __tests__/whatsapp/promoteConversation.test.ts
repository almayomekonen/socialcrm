import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import path from 'path'

const requireProductAccess = vi.hoisted(() => vi.fn())
const loadOwned = vi.hoisted(() => vi.fn())
const findMatches = vi.hoisted(() => vi.fn())
const upsertLead = vi.hoisted(() => vi.fn())
const attach = vi.hoisted(() => vi.fn())
const enqueue = vi.hoisted(() => vi.fn())
const findUnanswered = vi.hoisted(() => vi.fn())
const enqueueIre = vi.hoisted(() => vi.fn())
const runKick = vi.hoisted(() => vi.fn(async () => ({ claimed: 0, sent: 0, skipped: 0, failed: 0 })))
const afterFn = vi.hoisted(() => vi.fn((fn: () => unknown) => fn()))
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
vi.mock('@/lib/inbox/autoresponse/enqueueInboundAutoResponse', () => ({
  findLatestUnansweredInbound: findUnanswered,
  enqueueInboundAutoResponse: enqueueIre,
}))
vi.mock('@/lib/inbox/autoresponse/kickWorker', () => ({
  runAutoResponseKick: runKick,
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: afterFn }))
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
  findUnanswered.mockReset()
  findUnanswered.mockResolvedValue(null)
  enqueueIre.mockReset()
  enqueueIre.mockResolvedValue({ jobId: null, reason: 'qualify_turn', delaySeconds: 5 })
  runKick.mockClear()
  afterFn.mockClear()
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

const LEADLESS = {
  id: 371,
  agencyId: 103,
  leadId: null,
  isPersonal: false,
  customerWaId: '972524186300',
  customerName: 'george',
  channel: 'whatsapp',
}

describe('promote Contact → Lead enqueues existing IRE', () => {
  beforeEach(() => {
    requireProductAccess.mockResolvedValue({ id: 332, agencyId: 103 })
  })
  it('unanswered inbound → exactly one IRE job for the latest sequence', async () => {
    loadOwned.mockResolvedValue(LEADLESS)
    findMatches.mockResolvedValue([])
    upsertLead.mockResolvedValue({ id: 1416 })
    findUnanswered.mockResolvedValue({ id: 364, sequence: 2 })
    enqueueIre.mockResolvedValue({ jobId: 55, reason: 'qualify_turn', delaySeconds: 5 })

    const res = await promoteConversationToLead(371)
    expect(res).toEqual({ ok: true, leadId: 1416, created: true })
    expect(attach).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueueIre).toHaveBeenCalledTimes(1)
    expect(enqueueIre).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        agencyId: 103,
        conversationId: 371,
        leadId: 1416,
        triggerSequence: 2,
      }),
    )
    expect(afterFn).toHaveBeenCalledTimes(1)
    expect(runKick).toHaveBeenCalledTimes(1)
    expect(runKick).toHaveBeenCalledWith({ delaySeconds: 5, limit: 5 })
  })

  it('multiple unanswered inbounds → only the latest sequence is enqueued', async () => {
    loadOwned.mockResolvedValue(LEADLESS)
    findMatches.mockResolvedValue([])
    upsertLead.mockResolvedValue({ id: 1416 })
    findUnanswered.mockResolvedValue({ id: 364, sequence: 2 })
    enqueueIre.mockResolvedValue({ jobId: 55, reason: 'qualify_turn', delaySeconds: 5 })

    await promoteConversationToLead(371)
    expect(enqueueIre.mock.calls.map((c) => c[1].triggerSequence)).toEqual([2])
  })

  it('no inbound → no IRE job', async () => {
    loadOwned.mockResolvedValue(LEADLESS)
    findMatches.mockResolvedValue([])
    upsertLead.mockResolvedValue({ id: 1416 })
    findUnanswered.mockResolvedValue(null)

    await promoteConversationToLead(371)
    expect(attach).toHaveBeenCalled()
    expect(enqueue).toHaveBeenCalled()
    expect(enqueueIre).not.toHaveBeenCalled()
    expect(runKick).not.toHaveBeenCalled()
  })

  it('latest inbound already has an outbound → no IRE job', async () => {
    loadOwned.mockResolvedValue(LEADLESS)
    findMatches.mockResolvedValue([])
    upsertLead.mockResolvedValue({ id: 1416 })
    findUnanswered.mockResolvedValue(null)

    await promoteConversationToLead(371)
    expect(enqueueIre).not.toHaveBeenCalled()
  })

  it('repeated promotion of an already-linked conversation does not enqueue again', async () => {
    loadOwned.mockResolvedValue({ ...LEADLESS, leadId: 1416 })
    const res = await promoteConversationToLead(371)
    expect(res).toEqual({ ok: true, leadId: 1416, created: false })
    expect(attach).not.toHaveBeenCalled()
    expect(enqueueIre).not.toHaveBeenCalled()
    expect(runKick).not.toHaveBeenCalled()
  })

  it('existing enqueue guards returning null do not kick the worker', async () => {
    loadOwned.mockResolvedValue(LEADLESS)
    findMatches.mockResolvedValue([])
    upsertLead.mockResolvedValue({ id: 1416 })
    findUnanswered.mockResolvedValue({ id: 364, sequence: 2 })
    enqueueIre.mockResolvedValue({ jobId: null, reason: 'qualify_turn', delaySeconds: 5 })

    await promoteConversationToLead(371)
    expect(enqueueIre).toHaveBeenCalledTimes(1)
    expect(runKick).not.toHaveBeenCalled()
  })
})

describe('Contact → Lead IRE contracts', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

  it('Task 13: IRE follows the durable job, and Copilot analysis stays Lead-only', () => {
    const webhook = read('app/api/webhooks/whatsapp/route.ts')
    const ingest = read('lib/inbox/ingestWhatsappInbound.ts')
    // The kick is driven by whether ingest actually created a job, so a
    // non-personal Contact is answered while a personal one never is.
    expect(webhook).toContain('if (result.inserted && result.ireEnqueued)')
    expect(webhook).not.toContain('if (result.inserted && leadId != null && leadId > 0)')
    // Conversation analysis remains gated on a real Lead.
    expect(ingest).toContain('if (input.leadId != null && input.leadId > 0)')
    // IRE is gated on personal, not on the absence of a Lead.
    expect(ingest).toContain('if (!isPersonal)')
  })

  it('existing Lead inbound still uses the shared enqueue helper', () => {
    const ingest = read('lib/inbox/ingestWhatsappInbound.ts')
    expect(ingest).toContain('enqueueInboundAutoResponse')
    expect(ingest).not.toContain('enqueueAutoResponse(')
  })

  it('promotion reuses that helper and does not send WhatsApp itself', () => {
    const promote = read('actions/whatsapp/promoteConversationToLead.ts')
    expect(promote).toContain('enqueueInboundAutoResponse')
    expect(promote).toContain('findLatestUnansweredInbound')
    expect(promote).toContain('runAutoResponseKick')
    expect(promote).not.toContain('runAutoResponseWorker')
    expect(promote).not.toContain('sendWhatsappText')
    expect(promote).not.toContain('createLeadFromWhatsappWebhook')
  })

  it('delaySeconds still comes from auto_response_settings via the shared helper', () => {
    const helper = read('lib/inbox/autoresponse/enqueueInboundAutoResponse.ts')
    expect(helper).toContain(".first('mode', 'delaySeconds')")
    expect(helper).toContain('enqueueAutoResponse')
  })

  it('Phase B qualify path, safety gates, webhook, and cron are unchanged', () => {
    const worker = read('lib/inbox/autoresponse/worker.ts')
    const qualify = read('lib/inbox/autoresponse/qualifyWorker.ts')
    const webhook = read('app/api/webhooks/whatsapp/route.ts')
    const cron = read('app/api/cron/send-auto-responses/route.ts')
    const schema = read('lib/inbox/autoresponse/qualify.ts')
    expect(worker).toContain("if (settings?.mode === 'qualify')")
    expect(qualify).toContain('decidePostGeneration')
    expect(qualify).toContain('classifySalesTurnFromTranscript')
    expect(qualify).not.toContain('hotSignal: gen.hotSignal ||')
    expect(qualify).toContain('maxTurns')
    expect(schema).toContain("'discover_need', 'understand_pain', 'understand_impact', 'understand_outcome', 'advance'")
    expect(webhook).toContain('resolveInboundLeadDecision')
    expect(cron).toContain('runAutoResponseWorker()')
  })
})

