import { beforeEach, describe, expect, it, vi } from 'vitest'
import { classifySalesMove, classifySalesTurn } from '@/lib/inbox/autoresponse/salesIntent'
import { formatBusinessIdentityBlock, type BusinessIdentity } from '@/lib/inbox/autoresponse/businessIdentity'
import { buildQualifyUser, QUALIFY_SYSTEM_PROMPT } from '@/lib/inbox/autoresponse/qualifyPrompt'
import { formatProductKnowledgeBlock, retrieveProductKnowledge } from '@/lib/inbox/autoresponse/productRetrieve'
import { SOCIALCRM_CAPABILITIES } from '@/lib/product/capabilities'
import { decidePostGeneration } from '@/lib/inbox/autoresponse/stateMachine'
import { questionPolicyForSalesMove, validateAutoResponse } from '@/lib/inbox/autoresponse/validate'
import { finalizeCustomerFacingText, hasCustomerFacingDash } from '@/lib/inbox/autoresponse/customerFacingText'
import { mergeCognition } from '@/lib/inbox/autoresponse/qualification'

const AGENCY_A: BusinessIdentity = {
  agencyId: 103,
  name: 'SocialCRM',
  guidance: 'מערכת לניהול לידים מרשתות חברתיות. מרכזת פניות, וואטסאפ וסטטוס במקום אחד.',
  agentInstructions: null,
  // SocialCRM's own account: the one tenant whose business facts ARE the
  // product catalogue.
  isOwnProductBusiness: true,
}
const AGENCY_B: BusinessIdentity = {
  agencyId: 99,
  name: 'סטודיו אור',
  guidance: 'סטודיו לעיצוב פנים, מתמחים בדירות.',
  agentInstructions: null,
  isOwnProductBusiness: false,
}

function identityUser(inbound: string, identity: BusinessIdentity, salesMove?: string) {
  const move = salesMove ?? classifySalesMove(inbound)
  const pk = retrieveProductKnowledge({
    agencyId: identity.agencyId,
    inboundText: inbound,
    salesMove: move as 'PRODUCT_QUESTION',
    envRaw: identity.agencyId === 103 ? '103' : '',
  })
  return buildQualifyUser({
    transcript: [{ direction: 'inbound', text: inbound }],
    qualification: {},
    collectFields: { required: ['name', 'need'], optional: [] },
    guidance: identity.guidance,
    salesMove: move as 'PRODUCT_QUESTION',
    productKnowledgeBlock: formatProductKnowledgeBlock(pk),
    businessIdentityBlock: formatBusinessIdentityBlock(identity),
  })
}

describe('business identity classification', () => {
  it('במה אתם עוסקים? is PRODUCT_QUESTION, not DISCOVERY', () => {
    expect(classifySalesMove('במה אתם עוסקים?')).toBe('PRODUCT_QUESTION')
    expect(classifySalesMove('במה אתם עוסקים?')).not.toBe('DISCOVERY')
    expect(questionPolicyForSalesMove('PRODUCT_QUESTION')).toBe('zero_or_one')
  })
  it('מה אתם מציעים? is a direct product/identity question', () => {
    expect(classifySalesMove('מה אתם מציעים?')).toBe('PRODUCT_QUESTION')
    expect(classifySalesMove('מה אתם מציעים?')).not.toBe('DISCOVERY')
  })
  it('הגעתי מהמודעה שלכם is not discovery interrogation', () => {
    expect(classifySalesMove('הגעתי מהמודעה שלכם')).toBe('PRODUCT_QUESTION')
    expect(classifySalesMove('הגעתי מהפרסום שלכם')).toBe('PRODUCT_QUESTION')
    expect(classifySalesMove('הגעתי מהמודעה שלכם לגבי socialcrm')).toBe('PRODUCT_QUESTION')
  })
  it('מה השירותים שלכם? is PRODUCT_QUESTION', () => {
    expect(classifySalesMove('מה השירותים שלכם?')).toBe('PRODUCT_QUESTION')
    expect(classifySalesMove('איזה שירותים אתם נותנים?')).toBe('PRODUCT_QUESTION')
  })
  it('customer lead-volume stays discovery', () => {
    expect(classifySalesMove('כמה לידים נכנסים לך בחודש?')).toBe('DISCOVERY')
    expect(questionPolicyForSalesMove('DISCOVERY')).toBe('require_one')
  })
  it('HANDOFF_REQUEST remains the only commercial handoff authority', () => {
    expect(classifySalesMove('תעביר אותי לנציג')).toBe('HANDOFF_REQUEST')
    expect(decidePostGeneration({ hotSignal: true, uncertain: false, requiredComplete: false, turnCount: 1, maxTurns: 5, salesMove: 'PRODUCT_QUESTION' })).toEqual({
      action: 'send',
    })
    expect(decidePostGeneration({ hotSignal: true, uncertain: false, requiredComplete: false, turnCount: 1, maxTurns: 5, salesMove: 'HANDOFF_REQUEST' })).toEqual({
      action: 'escalate',
      reason: 'human_request',
    })
  })
  it('persistent salesStrategy still advances on identity questions', () => {
    const turn = classifySalesTurn({
      lastInbound: 'במה אתם עוסקים?',
      salesStrategy: 'discover',
    })
    expect(turn.salesMove).toBe('PRODUCT_QUESTION')
    expect(turn.salesStrategy).not.toBe('discover')
  })
})

describe('business identity prompt contract', () => {
  it('במה אתם עוסקים? gets a citeable identity block, not discovery interrogation', () => {
    const user = identityUser('במה אתם עוסקים?', AGENCY_A)
    expect(user).toContain('שם העסק: SocialCRM')
    expect(user).toContain('מה העסק עושה, ומה מותר לומר בשמו')
    expect(user).toContain('ניהול לידים')
    expect(user).toContain('זו שאלת זהות העסק')
    expect(user).toContain('אל תשאל/י את הלקוח על העסק')
    expect(user).not.toContain('לא לציטוט כעובדה')
    expect(user).not.toContain('בחרי יעד אחד עם הערך הכי גבוה עכשיו')
  })
  it('מה אתם מציעים? includes identity and product knowledge', () => {
    const user = identityUser('מה אתם מציעים?', AGENCY_A)
    expect(user).toContain('SocialCRM')
    expect(user).toMatch(/מאומת:|עובדות מוצר מאומתות/)
  })
  it('הגעתי מהמודעה שלכם forbids screenshot/link fishing', () => {
    const user = identityUser('הגעתי מהמודעה שלכם', AGENCY_A)
    expect(user).toMatch(/צילום מסך/)
    expect(QUALIFY_SYSTEM_PROMPT).toContain('אל תבקש/י צילום מסך')
  })
  it('מה השירותים שלכם? is answer-first with PK when allowlisted', () => {
    const pk = retrieveProductKnowledge({
      agencyId: 103,
      inboundText: 'מה השירותים שלכם?',
      salesMove: 'PRODUCT_QUESTION',
      envRaw: '103',
    })
    expect(pk.enabled).toBe(true)
    expect(pk.capabilities.length).toBeGreaterThan(0)
    const user = identityUser('מה השירותים שלכם?', AGENCY_A)
    expect(user).toContain('זו שאלת זהות העסק')
    expect(user).toContain('עובדות מוצר מאומתות')
  })
  it('price questions stay BUYING_SIGNAL and the prompt forbids invented prices', () => {
    expect(classifySalesMove('מה המחיר?')).toBe('BUYING_SIGNAL')
    const user = identityUser('מה המחיר?', AGENCY_A, 'BUYING_SIGNAL')
    expect(user).toContain('אסור להמציא שירות, מוצר, יכולת, מחיר')
    expect(validateAutoResponse('המחיר הוא 199 שקל לחודש', { questionPolicy: 'zero_or_one' }).ok).toBe(false)
    expect(validateAutoResponse('אין לי מחיר מאומת כרגע', { questionPolicy: 'zero_or_one' }).ok).toBe(true)
  })
  it('איך מתחילים? may use verified WhatsApp connect, not an invented demo', () => {
    expect(classifySalesMove('איך מתחילים?')).toBe('BUYING_SIGNAL')
    const pk = retrieveProductKnowledge({
      agencyId: 103,
      inboundText: 'איך מתחילים?',
      salesMove: 'BUYING_SIGNAL',
      envRaw: '103',
    })
    expect(pk.capabilities.some((c) => c.id === 'whatsapp_inbox')).toBe(true)
    expect(pk.capabilities.every((c) => !/הדגמה|\bdemo\b/i.test(`${c.safeExplanationHe} ${c.safeExplanationEn}`))).toBe(
      true,
    )
    expect(
      SOCIALCRM_CAPABILITIES.every((c) => !/הדגמה|\bdemo\b/i.test(`${c.name} ${c.safeExplanationHe} ${c.safeExplanationEn}`)),
    ).toBe(true)
    const user = identityUser('איך מתחילים?', AGENCY_A, 'BUYING_SIGNAL')
    expect(user).toContain('אסור להמציא תהליך הצטרפות, טופס, או שלב כלשהו')
    expect(user).toContain('צעד שמופיע במפורש בזהות העסק')
    expect(user).not.toContain('הצע צעד הבא ברור מהמוצר')
    expect(AGENCY_A.guidance).not.toMatch(/הדגמה|\bdemo\b/i)
    // "Do not invent an onboarding step" is enforced where the fact lives — the
    // prompt plus this business's own saved information — and no longer by a
    // global ban on the WORD הדגמה in the shared validator. That ban encoded one
    // tenant's fact (SocialCRM has no verified demo) into a guardrail every
    // tenant shares, so a business that genuinely runs demos could not say so.
    // The assertions above are the real protection; this one is its complement.
    expect(
      validateAutoResponse('אני לא רוצה להמציא לך את תהליך ההצטרפות המדויק. נציג יוכל לכוון אותך.', {
        questionPolicy: 'zero_or_one',
      }).ok,
    ).toBe(true)
  })
  it('commitment questions must not invent a guarantee', () => {
    const user = identityUser('מה אתם מתחייבים?', AGENCY_A)
    expect(user).toContain('אסור להמציא')
    expect(user).toContain('התחייבות')
    expect(validateAutoResponse('אני מתחייב שזה יעבוד אצלך', { questionPolicy: 'zero_or_one' }).ok).toBe(false)
  })
})

describe('tenant isolation of business identity', () => {
  it('agency A identity cannot appear in agency B context', () => {
    const a = formatBusinessIdentityBlock(AGENCY_A)
    const b = formatBusinessIdentityBlock(AGENCY_B)
    expect(a).toContain('SocialCRM')
    expect(a).not.toContain('סטודיו אור')
    expect(b).toContain('סטודיו אור')
    expect(b).not.toContain('SocialCRM')
    expect(b).not.toContain(AGENCY_A.guidance as string)
    const userB = identityUser('במה אתם עוסקים?', AGENCY_B)
    expect(userB).toContain('סטודיו אור')
    expect(userB).not.toContain('SocialCRM')
    expect(userB).not.toContain('מרשתות חברתיות')
    expect(userB).not.toContain('עובדות מוצר מאומתות')
  })
})

describe('no-dash still applies to identity answers', () => {
  it('finalizeCustomerFacingText remains the send gate', () => {
    const raw = 'SocialCRM מרכזת לידים — עם סטטוס ומעקב.'
    const out = finalizeCustomerFacingText(raw)
    expect(hasCustomerFacingDash(out)).toBe(false)
    expect(out).not.toContain('—')
  })
})

describe('P0.2 cognition merge still fill-empty', () => {
  it('salesStrategy advances while pain is sticky', () => {
    expect(mergeCognition({ pain: 'שוכחת לחזור', salesStrategy: 'discover' }, { salesStrategy: 'explain' })).toEqual({
      pain: 'שוכחת לחזור',
      salesStrategy: 'explain',
    })
  })
})

const agencyRows = vi.hoisted(() => ({
  103: { id: 103, name: 'SocialCRM' },
  99: { id: 99, name: 'סטודיו אור' },
}))
const settingsRows = vi.hoisted(() => ({
  '103:whatsapp': { agencyId: 103, guidance: 'CRM ללידים מרשתות' },
  '99:whatsapp': { agencyId: 99, guidance: 'סטודיו לעיצוב פנים' },
}))

vi.mock('@/config/db', () => ({
  db: (table: string) => ({
    where(q: Record<string, unknown>) {
      return {
        async first() {
          if (table === 'agencies') return agencyRows[q.id as keyof typeof agencyRows] ?? null
          if (table === 'auto_response_settings') {
            return settingsRows[`${q.agencyId}:${q.channel}` as keyof typeof settingsRows] ?? null
          }
          return null
        },
      }
    },
  }),
}))

describe('loadBusinessIdentity tenant scope', () => {
  beforeEach(() => {
    vi.resetModules()
  })
  it('loads only the requested agencyId', async () => {
    const { loadBusinessIdentity } = await import('@/lib/inbox/autoresponse/businessIdentity')
    const a = await loadBusinessIdentity(103, 'whatsapp')
    const b = await loadBusinessIdentity(99, 'whatsapp')
    expect(a).toEqual({ agencyId: 103, name: 'SocialCRM', guidance: 'CRM ללידים מרשתות' , agentInstructions: null, isOwnProductBusiness: false})
    expect(b).toEqual({ agencyId: 99, name: 'סטודיו אור', guidance: 'סטודיו לעיצוב פנים' , agentInstructions: null, isOwnProductBusiness: false})
    expect(a.guidance).not.toBe(b.guidance)
    expect(a.name).not.toBe(b.name)
  })
  it('does not return another agency when the id is missing', async () => {
    const { loadBusinessIdentity } = await import('@/lib/inbox/autoresponse/businessIdentity')
    const missing = await loadBusinessIdentity(777, 'whatsapp')
    expect(missing).toEqual({ agencyId: 777, name: null, guidance: null , agentInstructions: null, isOwnProductBusiness: false})
  })
})
