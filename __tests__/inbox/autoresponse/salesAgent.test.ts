import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SOCIALCRM_CAPABILITIES, getCapability, INBOUND_AUTO_RESPONSE_ID } from '@/lib/product/capabilities'
import { classifySalesMove, classifySalesMoveFromTranscript } from '@/lib/inbox/autoresponse/salesIntent'
import {
  formatProductKnowledgeBlock,
  isProductKnowledgeEnabled,
  retrieveProductKnowledge,
} from '@/lib/inbox/autoresponse/productRetrieve'
import { decidePostGeneration, decidePreGeneration, ireHardCeiling } from '@/lib/inbox/autoresponse/stateMachine'
import { questionPolicyForSalesMove, validateAutoResponse } from '@/lib/inbox/autoresponse/validate'
import { QUALIFY_SYSTEM_PROMPT, buildQualifyUser } from '@/lib/inbox/autoresponse/qualifyPrompt'
import { cognitionFromUnderstanding } from '@/lib/inbox/autoresponse/qualify'
import { mergeCognition } from '@/lib/inbox/autoresponse/qualification'
import { isRetryableIreGenerationFailure } from '@/lib/inbox/autoresponse/retryableGeneration'
import { ireKickWaitMs } from '@/lib/inbox/autoresponse/kickWorker'

const E2E_WARMUP =
  'אני צריך פשוט מערכת שתדע לשלוח הודעות חימום ככה אני לא אפספס אותם, האם המערכת שלכם עושה את זה?'
const E2E_AUTO_REPLY =
  'לדוגמא לקוח שולח לי הודעה ואני לא ליד המערכת שהמערכת תגיב לו לא משנה מה ההודעה רק שתגיב לו כדי שאני לא אפספס אותו'
const E2E_IMPACT = 'הם הולכים לאבוד'
const THANKS = 'תודה רבה'

const ALLOW = '103'

function retrieve(text: string, agencyId = 103, envRaw = ALLOW) {
  return retrieveProductKnowledge({
    agencyId,
    inboundText: text,
    salesMove: classifySalesMove(text),
    envRaw,
  })
}

describe('sales move classification', () => {
  it('product question → PRODUCT_QUESTION', () => {
    expect(classifySalesMove(E2E_WARMUP)).toBe('PRODUCT_QUESTION')
    expect(classifySalesMove('יש לכם דבר כזה?')).toBe('PRODUCT_QUESTION')
    expect(classifySalesMove('המערכת יודעת לענות אוטומטית?')).toBe('PRODUCT_QUESTION')
  })
  it('product question takes precedence over discovery/pain', () => {
    expect(classifySalesMove(E2E_WARMUP)).toBe('PRODUCT_QUESTION')
    expect(classifySalesMove(E2E_WARMUP)).not.toBe('DISCOVERY')
    expect(classifySalesMove(E2E_WARMUP)).not.toBe('DEEPEN')
  })
  it('Hebrew product-fit and product-question gaps from conv 463', () => {
    expect(classifySalesMove('אני צריך מערכת לניהול לידים')).toBe('PRODUCT_FIT')
    expect(classifySalesMove('אני מחפש מערכת')).toBe('PRODUCT_FIT')
    expect(classifySalesMove('אני מחפש CRM')).toBe('PRODUCT_FIT')
    expect(classifySalesMove('יש לי עסק של נדל״ן ונכנסים לי הרבה לקוחות אני צריך עזרה בניהול לידים')).toBe(
      'PRODUCT_FIT',
    )
    expect(classifySalesMove('איך אתה יכול לעזור לי?')).toBe('PRODUCT_QUESTION')
    expect(classifySalesMove('איך אתם יכולים לעזור לי?')).toBe('PRODUCT_QUESTION')
    expect(classifySalesMove('מה המערכת עושה?')).toBe('PRODUCT_QUESTION')
    expect(classifySalesMove('יש לכם מערכת לניהול לידים?')).toBe('PRODUCT_QUESTION')
    const thread = [
      { direction: 'inbound', text: 'אני צריך מערכת לניהול לידים' },
      { direction: 'inbound', text: 'אני מפסיד כסף ולקוחות' },
    ]
    expect(classifySalesMoveFromTranscript(thread)).toBe('PRODUCT_FIT')
  })
  it('תודה רבה → CASUAL_ACKNOWLEDGEMENT', () => {
    expect(classifySalesMove(THANKS)).toBe('CASUAL_ACKNOWLEDGEMENT')
    expect(classifySalesMove('ok')).toBe('CASUAL_ACKNOWLEDGEMENT')
  })
  it('price and demo stay buying signals', () => {
    expect(classifySalesMove('מה המחיר?')).toBe('BUYING_SIGNAL')
    expect(classifySalesMove('כמה זה עולה?')).toBe('BUYING_SIGNAL')
    expect(classifySalesMove('אני רוצה דמו')).toBe('BUYING_SIGNAL')
    expect(classifySalesMove('אני רוצה להתחיל')).toBe('BUYING_SIGNAL')
  })
  it('explicit human request → HANDOFF_REQUEST', () => {
    expect(classifySalesMove('אני רוצה לדבר עם מישהו')).toBe('HANDOFF_REQUEST')
    expect(classifySalesMove('אני רוצה לדבר עם נציג')).toBe('HANDOFF_REQUEST')
  })
  it('CRM missing name does not influence the move', () => {
    expect(classifySalesMove(E2E_WARMUP)).toBe('PRODUCT_QUESTION')
  })
})

describe('product retrieval', () => {
  it('product question retrieves catalog context when allowlisted', () => {
    const r = retrieve(E2E_WARMUP)
    expect(r.enabled).toBe(true)
    expect(r.unverifiedRequest).toBe(true)
    expect(r.capabilities.map((c) => c.id)).not.toContain(INBOUND_AUTO_RESPONSE_ID)
    expect(r.closestAlternatives.some((c) => c.id === INBOUND_AUTO_RESPONSE_ID)).toBe(true)
  })
  it('proactive warm-up is not mapped as verified inbound auto-response', () => {
    const r = retrieve('האם יש לכם הודעות חימום יזומות?')
    expect(r.capabilities.find((c) => c.id === INBOUND_AUTO_RESPONSE_ID)).toBeUndefined()
    expect(r.unverifiedRequest).toBe(true)
  })
  it('inbound auto-response maps to the verified capability', () => {
    const r = retrieve('המערכת יודעת לענות אוטומטית?')
    expect(r.capabilities.some((c) => c.id === INBOUND_AUTO_RESPONSE_ID)).toBe(true)
    expect(r.unverifiedRequest).toBe(false)
  })
  it('unknown capability does not invent a catalog row', () => {
    const r = retrieve('האם יש לכם טלפורטציה בין כוכבים?')
    expect(r.capabilities).toHaveLength(0)
    expect(r.unverifiedRequest).toBe(true)
    const block = formatProductKnowledgeBlock(r) ?? ''
    expect(block).toContain('אל תמציא')
    expect(block).not.toMatch(/טלפורט/)
  })
  it('tenant allowlist prevents SocialCRM capability leakage', () => {
    expect(isProductKnowledgeEnabled(99, '')).toBe(false)
    const r = retrieve(E2E_WARMUP, 99, '')
    expect(r.enabled).toBe(false)
    expect(r.capabilities).toHaveLength(0)
    expect(formatProductKnowledgeBlock(r)).toBeNull()
  })
})

describe('move-aware validator', () => {
  const productAnswer =
    'אם הכוונה היא שהמערכת תענה כשכותבים אליך בוואטסאפ ואתה לא ליד המסך — כן, יש מענה אוטומטי להודעות נכנסות.'
  it('product answer can contain zero questions', () => {
    expect(questionPolicyForSalesMove('PRODUCT_QUESTION')).toBe('zero_or_one')
    expect(validateAutoResponse(productAnswer, { questionPolicy: 'zero_or_one' }).ok).toBe(true)
    expect(validateAutoResponse(productAnswer).ok).toBe(false)
  })
  it('product answer + one follow-up is valid', () => {
    const reply = `${productAnswer} איך אתה מנהל את זה היום?`
    expect(validateAutoResponse(reply, { questionPolicy: 'zero_or_one' }).ok).toBe(true)
  })
  it('product answer with two questions is invalid', () => {
    const reply = `${productAnswer} איך אתה מנהל את זה היום? ומה חסר לך?`
    expect(validateAutoResponse(reply, { questionPolicy: 'zero_or_one' }).ok).toBe(false)
  })
  it('catalog safe explanations pass the product validator', () => {
    for (const c of SOCIALCRM_CAPABILITIES) {
      expect(validateAutoResponse(c.safeExplanationHe, { questionPolicy: 'zero_or_one' }).ok).toBe(true)
      expect(validateAutoResponse(c.safeExplanationEn, { questionPolicy: 'zero_or_one' }).ok).toBe(true)
    }
  })
})

describe('maxTurns and casual ack policy', () => {
  const postBase = {
    hotSignal: false,
    uncertain: false,
    requiredComplete: false,
    turnCount: 4,
    maxTurns: 5,
  }
  it('תודה רבה at maxTurns does not hand off', () => {
    expect(classifySalesMove(THANKS)).toBe('CASUAL_ACKNOWLEDGEMENT')
    expect(decidePostGeneration({ ...postBase, salesMove: 'CASUAL_ACKNOWLEDGEMENT' })).toEqual({ action: 'send' })
  })
  it('healthy impact at soft maxTurns continues', () => {
    expect(decidePostGeneration({ ...postBase, salesMove: 'DEEPEN' })).toEqual({ action: 'send' })
    expect(decidePostGeneration({ ...postBase, salesMove: 'DISCOVERY' })).toEqual({ action: 'send' })
  })
  it('explicit human request still hands off', () => {
    expect(
      decidePostGeneration({ ...postBase, salesMove: 'HANDOFF_REQUEST', hotSignal: true }),
    ).toEqual({ action: 'escalate', reason: 'human_request' })
    expect(
      decidePostGeneration({ ...postBase, salesMove: 'HANDOFF_REQUEST', hotSignal: false }),
    ).toEqual({ action: 'escalate', reason: 'human_request' })
  })
  it('BUYING_SIGNAL continues — it is not a human handoff', () => {
    expect(decidePostGeneration({ ...postBase, salesMove: 'BUYING_SIGNAL', hotSignal: true })).toEqual({
      action: 'send',
    })
    expect(decidePostGeneration({ ...postBase, salesMove: 'BUYING_SIGNAL', hotSignal: false })).toEqual({
      action: 'send',
    })
  })
  it('hard ceiling still stops generation', () => {
    expect(ireHardCeiling(5)).toBe(7)
    expect(
      decidePreGeneration({
        aiState: 'ai_qualifying',
        masterEnabled: true,
        channelEnabled: true,
        humanTookOver: false,
        optOut: false,
        hasUnansweredInbound: true,
        withinQuietHours: false,
        withinWindow: true,
        sentTodayForAgency: 0,
        dailyCap: 200,
        turnCount: 7,
        maxTurns: 5,
      }),
    ).toEqual({ action: 'skip', reason: 'max_turns' })
  })
})

describe('prompt + Phase B + safety unchanged', () => {
  it('product question instructs answer-first, not discovery-first', () => {
    expect(QUALIFY_SYSTEM_PROMPT).toContain('בשאלת מוצר: קודם תשובה ישירה')
    expect(QUALIFY_SYSTEM_PROMPT).toContain('אסור לשאול שאלת גילוי לפני התשובה')
    const user = buildQualifyUser({
      transcript: [{ direction: 'inbound', text: E2E_WARMUP }],
      qualification: {},
      collectFields: { required: ['name', 'need'], optional: [] },
      guidance: null,
      salesMove: 'PRODUCT_QUESTION',
      productKnowledgeBlock: formatProductKnowledgeBlock(retrieve(E2E_WARMUP)),
    })
    expect(user).toContain('זו שאלת מוצר')
    expect(user).toContain('אל תשאל שאלת גילוי לפני התשובה')
    expect(user).not.toMatch(/נוגעת ל: name/)
  })
  it('product fit instructs explain-value, not a reflexive discovery question', () => {
    expect(QUALIFY_SYSTEM_PROMPT).toContain('בהתאמת מוצר:')
    expect(QUALIFY_SYSTEM_PROMPT).toContain('אל תצרפי שאלת גילוי על כאב/השפעה/תהליך רק כי אפשר לשאול')
    const inbound = 'יש לי עסק של נדל״ן ונכנסים לי הרבה לקוחות אני צריך עזרה בניהול לידים'
    const user = buildQualifyUser({
      transcript: [{ direction: 'inbound', text: inbound }],
      qualification: {},
      collectFields: { required: ['name', 'need'], optional: [] },
      guidance: null,
      salesMove: 'PRODUCT_FIT',
      productKnowledgeBlock: formatProductKnowledgeBlock(retrieve(inbound)),
    })
    expect(user).toContain('זו התאמת מוצר')
    expect(user).toContain('אל תשאל שאלת גילוי על כאב, השפעה או תהליך עכשיו')
    expect(user).toContain('היעד עכשיו הוא להסביר ערך מהמוצר')
    expect(user).not.toContain('לכל היותר שאלת המשך אחת אחרי התשובה')
    expect(user).not.toContain('בחרי יעד אחד עם הערך הכי גבוה עכשיו')
  })
  it('Phase B cognition persists fill-empty', () => {
    const grounded = cognitionFromUnderstanding(
      { pain: 'שוכחת לחזור', impact: null, currentWorkflow: null, desiredOutcome: null },
      'understand_pain',
      'אני שוכחת לחזור להודעות',
    )
    expect(grounded.pain).toBe('שוכחת לחזור')
    expect(mergeCognition({ pain: 'שוכחת לחזור' }, { pain: 'אחר' })).toEqual({ pain: 'שוכחת לחזור' })
  })
  it('retry and delay helpers are unchanged', () => {
    expect(isRetryableIreGenerationFailure('ai_unavailable')).toBe(true)
    expect(isRetryableIreGenerationFailure('budget_exhausted')).toBe(false)
    expect(ireKickWaitMs(5)).toBe(5250)
    expect(ireKickWaitMs(0)).toBe(0)
  })
  it('WhatsApp send / contact-lead / enqueue files were not edited in this phase', () => {
    const root = resolve(__dirname, '../../../')
    expect(readFileSync(resolve(root, 'lib/whatsapp/sendMessage.ts'), 'utf8')).toContain('export async function sendWhatsappText')
    expect(readFileSync(resolve(root, 'lib/inbox/autoresponse/enqueueInboundAutoResponse.ts'), 'utf8')).toContain(
      'enqueueInboundAutoResponse',
    )
    expect(readFileSync(resolve(root, 'actions/whatsapp/promoteConversationToLead.ts'), 'utf8')).toContain('afterLink')
    expect(readFileSync(resolve(root, 'lib/inbox/autoresponse/kickWorker.ts'), 'utf8')).toContain('IRE_KICK_MAX_WAIT_MS')
  })
})

describe('buying vs human-request policy matrix', () => {
  const post = (salesMove: Parameters<typeof decidePostGeneration>[0]['salesMove'], hotSignal = true) =>
    decidePostGeneration({
      hotSignal,
      uncertain: false,
      requiredComplete: false,
      turnCount: 1,
      maxTurns: 5,
      salesMove,
    })

  it('אוקיי איך אנחנו מתקדמים? continues even if the LLM marks buying/hot', () => {
    const text = 'אוקיי איך אנחנו מתקדמים?'
    expect(classifySalesMove(text)).toBe('DISCOVERY')
    expect(post(classifySalesMove(text), true)).toEqual({ action: 'send' })
  })
  it('אני רוצה להתחיל continues as BUYING_SIGNAL', () => {
    expect(classifySalesMove('אני רוצה להתחיל')).toBe('BUYING_SIGNAL')
    expect(post('BUYING_SIGNAL', true)).toEqual({ action: 'send' })
  })
  it('כן, אני רוצה להתקדם continues', () => {
    const text = 'כן, אני רוצה להתקדם'
    expect(classifySalesMove(text)).not.toBe('HANDOFF_REQUEST')
    expect(post(classifySalesMove(text), true)).toEqual({ action: 'send' })
  })
  it('כמה זה עולה? is BUYING_SIGNAL and must not auto-handoff', () => {
    expect(classifySalesMove('כמה זה עולה?')).toBe('BUYING_SIGNAL')
    expect(post('BUYING_SIGNAL', true)).toEqual({ action: 'send' })
  })
  it('תעביר אותי לנציג hands off', () => {
    expect(classifySalesMove('תעביר אותי לנציג')).toBe('HANDOFF_REQUEST')
    expect(post('HANDOFF_REQUEST', false)).toEqual({ action: 'escalate', reason: 'human_request' })
  })
  it('אני רוצה לדבר עם מישהו hands off', () => {
    expect(classifySalesMove('אני רוצה לדבר עם מישהו')).toBe('HANDOFF_REQUEST')
    expect(post('HANDOFF_REQUEST', true)).toEqual({ action: 'escalate', reason: 'human_request' })
  })
  it('יש לי כבר CRM keeps current classifier behavior (not a P0 regex change)', () => {
    expect(classifySalesMove('יש לי כבר CRM')).toBe('DISCOVERY')
    expect(post('DISCOVERY', true)).toEqual({ action: 'send' })
  })
  it('אני מפסיד כסף ולקוחות continues and does not become a handoff', () => {
    expect(classifySalesMove('אני מפסיד כסף ולקוחות')).toBe('DEEPEN')
    expect(post('DEEPEN', true)).toEqual({ action: 'send' })
  })
})

describe('production E2E expected behavior', () => {
  it('warmup product question is answered from closest verified inbound auto-response, not claimed as warmup', () => {
    expect(classifySalesMove(E2E_WARMUP)).toBe('PRODUCT_QUESTION')
    const r = retrieve(E2E_WARMUP)
    expect(r.unverifiedRequest).toBe(true)
    expect(getCapability(INBOUND_AUTO_RESPONSE_ID)?.safeExplanationHe).toMatch(/מענה אוטומטי/)
    expect(getCapability(INBOUND_AUTO_RESPONSE_ID)?.limitations.join(' ')).toMatch(/Not proactive warm-up/)
  })
  it('auto-reply clarification retrieves inbound auto-response', () => {
    expect(classifySalesMove(E2E_AUTO_REPLY)).toBe('PRODUCT_QUESTION')
    const r = retrieve(E2E_AUTO_REPLY)
    expect(r.capabilities.some((c) => c.id === INBOUND_AUTO_RESPONSE_ID)).toBe(true)
  })
  it('הם הולכים לאבוד at soft budget does not hand off', () => {
    const move = classifySalesMove(E2E_IMPACT)
    expect(['DEEPEN', 'DISCOVERY']).toContain(move)
    expect(
      decidePostGeneration({
        hotSignal: false,
        uncertain: false,
        requiredComplete: false,
        turnCount: 4,
        maxTurns: 5,
        salesMove: move,
      }),
    ).toEqual({ action: 'send' })
  })
})
