import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The send action: agent-level permission (NOT admin), agency-scoped template load,
 * approved-only, SEND-then-persist, token never in the result, Meta code mapped to
 * Hebrew. Leaf modules are mocked; `variables.ts` (param resolution) runs for real.
 */

const h = vi.hoisted(() => ({
  requireAgencyUser: vi.fn(),
  isTemplatesEnabledForAgency: vi.fn(),
  loadTemplateForSend: vi.fn(),
  getAgencyById: vi.fn(),
  resolveWhatsappOutboundTarget: vi.fn(),
  sendWhatsappTemplate: vi.fn(),
  persistOutboundWhatsapp: vi.fn(),
  recordAccountRestriction: vi.fn(),
}))

vi.mock('@/lib/requireUser', () => ({ requireAgencyUser: h.requireAgencyUser, requireProductAccess: h.requireAgencyUser }))
vi.mock('@/lib/whatsapp/templates/flag', () => ({ isTemplatesEnabledForAgency: h.isTemplatesEnabledForAgency }))
vi.mock('@/db/whatsappTemplates', () => ({ loadTemplateForSend: h.loadTemplateForSend }))
vi.mock('@/db/agencies', () => ({ getAgencyById: h.getAgencyById }))
vi.mock('@/lib/inbox/whatsappOutboundTarget', () => ({ resolveWhatsappOutboundTarget: h.resolveWhatsappOutboundTarget }))
vi.mock('@/lib/whatsapp/sendTemplateMessage', () => ({ sendWhatsappTemplate: h.sendWhatsappTemplate }))
vi.mock('@/lib/inbox/persistOutboundWhatsapp', () => ({ persistOutboundWhatsapp: h.persistOutboundWhatsapp }))
vi.mock('@/lib/inbox/recordAccountRestriction', () => ({ recordAccountRestriction: h.recordAccountRestriction }))

const { sendTemplateToLead } = await import('@/actions/whatsapp/templates/sendTemplateToLead')

const APPROVED = {
  id: 55,
  status: 'approved' as const,
  name: 'follow_up',
  language: 'he',
  bodyText: 'היי שם הליד, כאן שם העסק.',
  variables: [
    { token: 'שם הליד', sample: 'דוד' },
    { token: 'שם העסק', sample: 'העסק שלי' },
  ],
}

const TARGET = {
  ok: true as const,
  target: {
    leadId: 9,
    leadName: 'דוד כהן',
    businessPhoneNumberId: 'PN_1',
    accessToken: 'secret-token',
    customerWaId: '972537736636',
    customerName: 'דוד כהן',
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireAgencyUser.mockResolvedValue({ id: 7, agencyId: 103, role: 'agent' })
  h.isTemplatesEnabledForAgency.mockReturnValue(true)
  h.loadTemplateForSend.mockResolvedValue(APPROVED)
  h.getAgencyById.mockResolvedValue({ name: 'סושיאל בע"מ' })
  h.resolveWhatsappOutboundTarget.mockResolvedValue(TARGET)
  h.sendWhatsappTemplate.mockResolvedValue({ ok: true, wamid: 'wamid.X' })
  h.persistOutboundWhatsapp.mockResolvedValue({ conversationId: 1, messageId: 2 })
  h.recordAccountRestriction.mockResolvedValue(undefined)
})

describe('sendTemplateToLead — validation & gating', () => {
  it('rejects invalid ids before any work', async () => {
    expect(await sendTemplateToLead(0, 5)).toEqual({ ok: false, error: 'בקשה לא תקינה.' })
    expect(await sendTemplateToLead(9, -1)).toEqual({ ok: false, error: 'בקשה לא תקינה.' })
    expect(h.loadTemplateForSend).not.toHaveBeenCalled()
  })

  it('rejects when the feature is not enabled for the agency (defense in depth)', async () => {
    h.isTemplatesEnabledForAgency.mockReturnValue(false)
    expect(await sendTemplateToLead(9, 55)).toEqual({ ok: false, error: 'שליחת הודעות WhatsApp מוכנות אינה זמינה.' })
    expect(h.loadTemplateForSend).not.toHaveBeenCalled()
  })
})

describe('sendTemplateToLead — template must be this agency’s and approved', () => {
  it('loads the template scoped to the caller agency', async () => {
    await sendTemplateToLead(9, 55)
    expect(h.loadTemplateForSend).toHaveBeenCalledWith(55, 103)
  })

  it('not found → NOT_FOUND, nothing sent', async () => {
    h.loadTemplateForSend.mockResolvedValue(null)
    expect(await sendTemplateToLead(9, 55)).toEqual({ ok: false, error: 'ההודעה המוכנה לא נמצאה.' })
    expect(h.sendWhatsappTemplate).not.toHaveBeenCalled()
  })

  it('pending/rejected are NOT sendable', async () => {
    for (const status of ['pending', 'rejected', 'paused', 'disabled'] as const) {
      h.loadTemplateForSend.mockResolvedValue({ ...APPROVED, status })
      expect(await sendTemplateToLead(9, 55)).toEqual({ ok: false, error: 'אפשר לשלוח רק הודעה שאושרה.' })
    }
    expect(h.sendWhatsappTemplate).not.toHaveBeenCalled()
  })
})

describe('sendTemplateToLead — targeting', () => {
  it('maps no-connection and no-recipient to distinct Hebrew errors', async () => {
    h.resolveWhatsappOutboundTarget.mockResolvedValue({ ok: false, reason: 'no-connection' })
    expect(await sendTemplateToLead(9, 55)).toEqual({ ok: false, error: 'צריך לחבר וואטסאפ עסקי כדי לשלוח.' })
    h.resolveWhatsappOutboundTarget.mockResolvedValue({ ok: false, reason: 'no-recipient' })
    expect(await sendTemplateToLead(9, 55)).toEqual({ ok: false, error: 'אין מספר וואטסאפ פעיל לליד הזה.' })
    h.resolveWhatsappOutboundTarget.mockResolvedValue({ ok: false, reason: 'lead-not-found' })
    expect(await sendTemplateToLead(9, 55)).toEqual({ ok: false, error: 'אין מספר וואטסאפ פעיל לליד הזה.' })
    expect(h.sendWhatsappTemplate).not.toHaveBeenCalled()
  })
})

describe('sendTemplateToLead — happy path', () => {
  it('sends the approved template with resolved, non-empty, correctly-ordered params', async () => {
    const res = await sendTemplateToLead(9, 55)
    expect(res).toEqual({ ok: true })

    const call = h.sendWhatsappTemplate.mock.calls[0][0]
    expect(call.phoneNumberId).toBe('PN_1')
    expect(call.accessToken).toBe('secret-token')
    expect(call.to).toBe('972537736636')
    expect(call.name).toBe('follow_up')
    expect(call.language).toBe('he')
    // body order: lead first, business second → resolved from the lead + agency
    expect(call.params).toEqual(['דוד', 'סושיאל בע"מ'])
  })

  it('persists the outbound with the human-readable rendered text and the wamid', async () => {
    await sendTemplateToLead(9, 55)
    const p = h.persistOutboundWhatsapp.mock.calls[0][0]
    expect(p).toMatchObject({ agencyId: 103, leadId: 9, sentByUserId: 7, wamid: 'wamid.X' })
    expect(p.text).toBe('היי דוד, כאן סושיאל בע"מ.')
  })

  it('falls back to a non-empty lead name when the lead has none (no empty param)', async () => {
    h.resolveWhatsappOutboundTarget.mockResolvedValue({ ...TARGET, target: { ...TARGET.target, leadName: null } })
    await sendTemplateToLead(9, 55)
    const call = h.sendWhatsappTemplate.mock.calls[0][0]
    expect(call.params[0].trim().length).toBeGreaterThan(0)
  })

  it('never leaks the access token in the result', async () => {
    const res = await sendTemplateToLead(9, 55)
    expect(JSON.stringify(res)).not.toContain('secret-token')
  })
})

describe('sendTemplateToLead — failure handling', () => {
  it('maps a Meta send error code to Hebrew and does not persist', async () => {
    h.sendWhatsappTemplate.mockResolvedValue({ ok: false, error: 'raw meta', code: '141006', httpStatus: 400 })
    const res = await sendTemplateToLead(9, 55)
    expect(res.ok).toBe(false)
    if (res.ok === false) {
      expect(res.error).toMatch(/[֐-׿]/) // Hebrew
      expect(res.error).not.toContain('raw meta')
      expect(res.error).not.toMatch(/\d{4,}/) // no raw code
    }
    expect(h.persistOutboundWhatsapp).not.toHaveBeenCalled()
  })

  it('131031 records an account restriction so Connection Health updates immediately', async () => {
    h.sendWhatsappTemplate.mockResolvedValue({ ok: false, error: 'restricted', code: '131031', httpStatus: 400 })
    const res = await sendTemplateToLead(9, 55)
    expect(res.ok).toBe(false)
    if (res.ok === false) {
      expect(res.error).toBe('ההודעה לא נשלחה — שליחת הודעות מושבתת כרגע. נדרשת בדיקה בהגדרות החשבון.')
    }
    expect(h.recordAccountRestriction).toHaveBeenCalledWith({
      agencyId: 103,
      leadId: 9,
      businessPhoneNumberId: 'PN_1',
      customerWaId: '972537736636',
      customerName: 'דוד כהן',
      sentByUserId: 7,
      text: 'היי דוד, כאן סושיאל בע"מ.',
    })
    expect(h.persistOutboundWhatsapp).not.toHaveBeenCalled()
  })

  it('131047 / generic does not record an account restriction', async () => {
    h.sendWhatsappTemplate.mockResolvedValue({ ok: false, error: 'window', code: '131047', httpStatus: 400 })
    await sendTemplateToLead(9, 55)
    expect(h.recordAccountRestriction).not.toHaveBeenCalled()
  })

  it('a send with no code still returns a generic Hebrew failure', async () => {
    h.sendWhatsappTemplate.mockResolvedValue({ ok: false, error: 'network-error' })
    const res = await sendTemplateToLead(9, 55)
    expect(res).toEqual({ ok: false, error: 'ההודעה לא נשלחה. נסו שוב.' })
  })

  it('a successful send but failed persist surfaces honestly (no fake success)', async () => {
    h.persistOutboundWhatsapp.mockRejectedValue(new Error('db down'))
    const res = await sendTemplateToLead(9, 55)
    expect(res).toEqual({ ok: false, error: 'ההודעה נשלחה אך לא נשמרה בשיחה. רעננו את הדף.' })
  })
})

describe('sendTemplateToLead — Meta-synced (positional) templates', () => {
  // lead_first_contact shape: variables=[], body has {{1}}/{{2}}.
  const ADOPTED = {
    id: 5,
    status: 'approved' as const,
    name: 'lead_first_contact',
    language: 'he',
    bodyText: 'היי {{1}}, תודה שהתעניינת ב{{2}}.',
    variables: [],
  }

  it('sends the correct param count when bindings are set (the #132000 fix)', async () => {
    h.loadTemplateForSend.mockResolvedValue({
      ...ADOPTED,
      bindings: [{ position: 1, source: 'leadFirstName' }, { position: 2, source: 'businessName' }],
    })
    const res = await sendTemplateToLead(9, 5)
    expect(res).toEqual({ ok: true })
    const call = h.sendWhatsappTemplate.mock.calls[0][0]
    expect(call.params).toEqual(['דוד', 'סושיאל בע"מ']) // 2 params, not 0
    // persisted body has {{n}} substituted with resolved values
    expect(h.persistOutboundWhatsapp.mock.calls[0][0].text).toBe('היי דוד, תודה שהתעניינת בסושיאל בע"מ.')
  })

  it('blocks with a clear message (not generic) when the positional template is unmapped', async () => {
    h.loadTemplateForSend.mockResolvedValue({ ...ADOPTED, bindings: [] })
    const res = await sendTemplateToLead(9, 5)
    expect(res).toEqual({ ok: false, error: 'ההודעה הזו סונכרנה מ‑Meta וצריך להגדיר אילו פרטים ממלאים אותה לפני השליחה.' })
    // never reaches Meta with a mismatched count
    expect(h.sendWhatsappTemplate).not.toHaveBeenCalled()
  })
})
