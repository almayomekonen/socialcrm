/**
 * The conversational agent's pure pieces: mode memory, the turn rules for
 * social conversations, the owner's agent profile, the CRM relationship and the
 * layered prompt. No database, no model.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  HINT_TTL_MS,
  businessTurnCount,
  formatModeHint,
  nextConversationMemory,
  parseConversationMemory,
  shouldNotifyPersonal,
  socialHintHolds,
  type ConversationMemory,
} from '@/lib/inbox/autoresponse/conversational/mode'
import { isSchedulingRequest, meetingNeedsTeam, meetingOnlyHandoff, personalReplyWarranted, socialReopen, socialTurn } from '@/lib/inbox/autoresponse/conversational/turnRules'
import {
  AGENT_PROFILE_LIMITS,
  agentProfileGroundedFacts,
  formatAgentProfileBlock,
  isEmptyAgentProfile,
  normalizeAgentProfile,
  storableAgentProfile,
} from '@/lib/inbox/autoresponse/conversational/agentProfile'
import { formatCrmContextBlock, relationshipFrom, type CrmContext } from '@/lib/inbox/autoresponse/conversational/crmContext'
import { CONVERSATIONAL_SYSTEM_PROMPT, buildConversationalUser } from '@/lib/inbox/autoresponse/conversational/prompt'
import { QUALIFY_SYSTEM_PROMPT } from '@/lib/inbox/autoresponse/qualifyPrompt'
import { mergeQualification } from '@/lib/inbox/autoresponse/qualification'
import { canUseConversationalAgent, conversationalAgentAgencyIds } from '@/lib/flags/conversationalAgentFlags'

const NOW = Date.parse('2030-11-12T12:00:00Z')
const mem = (over: Partial<ConversationMemory> = {}): ConversationMemory => ({
  mode: 'personal',
  confidence: 'high',
  updatedAt: new Date(NOW - 60_000).toISOString(),
  personalTurns: 1,
  ...over,
})

describe('the rollout flag', () => {
  const saved = process.env.IRE_CONVERSATIONAL_AGENCY_IDS
  afterEach(() => {
    if (saved === undefined) delete process.env.IRE_CONVERSATIONAL_AGENCY_IDS
    else process.env.IRE_CONVERSATIONAL_AGENCY_IDS = saved
  })
  it('absence blocks; only named agencies; "all" is not accepted', () => {
    delete process.env.IRE_CONVERSATIONAL_AGENCY_IDS
    expect(canUseConversationalAgent(103)).toBe(false)
    process.env.IRE_CONVERSATIONAL_AGENCY_IDS = 'all'
    expect(canUseConversationalAgent(103)).toBe(false)
    process.env.IRE_CONVERSATIONAL_AGENCY_IDS = ' 103, x, 0, -4, 7.5 '
    expect([...conversationalAgentAgencyIds()]).toEqual([103])
    expect(canUseConversationalAgent(103)).toBe(true)
    expect(canUseConversationalAgent(104)).toBe(false)
    expect(canUseConversationalAgent(null)).toBe(false)
  })
})

describe('mode memory is a hint, never a label', () => {
  it('a stored memory survives every qualification merge, and the newest turn replaces it', () => {
    const current = { need: 'אירוע', conversation: mem() }
    expect(mergeQualification(current, { name: 'דנה' }).conversation).toEqual(mem())
    const next = mem({ mode: 'pricing', personalTurns: 1 })
    expect(mergeQualification(current, { conversation: next }).conversation).toEqual(next)
  })

  it('invalid stored values are no memory at all', () => {
    expect(parseConversationMemory(null)).toBeNull()
    expect(parseConversationMemory({ mode: 'friend', confidence: 'high', updatedAt: new Date(NOW).toISOString() })).toBeNull()
    expect(parseConversationMemory({ mode: 'personal', confidence: 'high', updatedAt: 'yesterday' })).toBeNull()
    expect(parseConversationMemory(mem())).toEqual(mem())
  })

  it('only a fresh, confident social memory relaxes the sales turn rules', () => {
    expect(socialHintHolds(mem(), NOW)).toBe(true)
    expect(socialHintHolds(mem({ mode: 'mixed' }), NOW)).toBe(true)
    expect(socialHintHolds(mem({ confidence: 'low' }), NOW)).toBe(false)
    expect(socialHintHolds(mem({ mode: 'prospect' }), NOW)).toBe(false)
    expect(socialHintHolds(mem({ updatedAt: new Date(NOW - HINT_TTL_MS - 1).toISOString() }), NOW)).toBe(false)
    expect(socialHintHolds(null, NOW)).toBe(false)
  })

  it('the prompt is told the memory is only a hint, and the current message decides', () => {
    const hint = formatModeHint(mem(), NOW)!
    expect(hint).toContain('רמז בלבד')
    expect(hint).toContain('ההודעה הנוכחית')
    expect(formatModeHint(mem({ updatedAt: new Date(NOW - HINT_TTL_MS - 1).toISOString() }), NOW)).toBeNull()
  })

  it('a business turn after personal ones replaces the mode; personal turns never spend the discovery budget', () => {
    const after = nextConversationMemory(mem({ personalTurns: 3 }), { mode: 'pricing', confidence: 'high', nowMs: NOW })
    expect(after).toMatchObject({ mode: 'pricing', personalTurns: 3 })
    expect(businessTurnCount(5, after)).toBe(2)
    expect(businessTurnCount(2, null)).toBe(2)
  })

  it('the owner is told once: the first confident personal turn, never again', () => {
    expect(shouldNotifyPersonal(null, { mode: 'personal', confidence: 'medium' })).toBe(true)
    expect(shouldNotifyPersonal(null, { mode: 'personal', confidence: 'low' })).toBe(false)
    expect(shouldNotifyPersonal(null, { mode: 'prospect', confidence: 'high' })).toBe(false)
    const notified = nextConversationMemory(null, { mode: 'personal', confidence: 'high', nowMs: NOW, notified: true })
    expect(notified.personalNotifiedAt).toBe(new Date(NOW).toISOString())
    expect(shouldNotifyPersonal(notified, { mode: 'personal', confidence: 'high' })).toBe(false)
    expect(nextConversationMemory(notified, { mode: 'prospect', confidence: 'high', nowMs: NOW + 1 }).personalNotifiedAt).toBe(notified.personalNotifiedAt)
  })
})

describe('turn rules in a social conversation', () => {
  it.each([
    ['חחחח', true],
    ['חחחח הרגת אותי', true],
    ['מה איתך?', true],
    ['סבבה נדבר על זה, מה איתך בכללי?', true],
    ['😂😂', true],
    ['👍', false],
    ['סבבה', false],
    ['תודה', false],
    ['❤️', false],
    ['', false],
  ])('"%s" warrants a reply: %s', (text, expected) => {
    expect(personalReplyWarranted(text)).toBe(expected)
  })

  it('without a social memory the sales rules decide, unchanged', () => {
    expect(socialTurn({ socialHint: false, inboundText: 'חחחח', salesRuleSilences: true })).toBe('default')
    expect(socialTurn({ socialHint: true, inboundText: 'חחחח', salesRuleSilences: false })).toBe('default')
  })

  it('with one, laughter reaches the model and a thumbs up is skipped without closing', () => {
    expect(socialTurn({ socialHint: true, inboundText: 'חחחח', salesRuleSilences: true })).toBe('generate')
    expect(socialTurn({ socialHint: true, inboundText: '👍', salesRuleSilences: true })).toBe('skip_quietly')
    expect(socialReopen({ socialHint: true, inboundText: 'מה איתך?' })).toBe(true)
    expect(socialReopen({ socialHint: true, inboundText: '👍' })).toBe(false)
    expect(socialReopen({ socialHint: false, inboundText: 'מה איתך?' })).toBe(false)
  })
})

describe('the owner\'s agent profile', () => {
  it('validates, cleans and caps; drops what is incomplete; never invents', () => {
    const p = normalizeAgentProfile({
      greeting: '  היי,​ ברוכים הבאים!  ',
      persona: 'נעים'.repeat(400),
      tone: 'sarcastic',
      faq: [{ question: 'כמה זמן מראש?', answer: 'חודשיים' }, { question: 'בלי תשובה', answer: '' }, 'garbage'],
      escalationTopics: ['החזר כספי', 'החזר כספי', '', 7],
    })
    expect(p.greeting).toBe('היי, ברוכים הבאים!')
    expect([...p.persona!]).toHaveLength(AGENT_PROFILE_LIMITS.persona)
    expect(p.tone).toBeNull()
    expect(p.faq).toEqual([{ question: 'כמה זמן מראש?', answer: 'חודשיים' }])
    expect(p.escalationTopics).toEqual(['החזר כספי'])
  })

  it('an empty profile is stored as NULL and produces no prompt block', () => {
    const empty = normalizeAgentProfile({ greeting: '   ', faq: [] })
    expect(isEmptyAgentProfile(empty)).toBe(true)
    expect(storableAgentProfile(empty)).toBeNull()
    expect(formatAgentProfileBlock(empty)).toBeNull()
    expect(normalizeAgentProfile('not json')).toEqual(empty)
  })

  it('the FAQ answers are quotable facts; the block names the escalation contract', () => {
    const p = normalizeAgentProfile({ tone: 'warm', faq: [{ question: 'מחיר לחתונה?', answer: 'מ-180 ₪ למנה' }], escalationTopics: ['ביטול אירוע'] })
    expect(agentProfileGroundedFacts(p)).toContain('180 ₪')
    const block = formatAgentProfileBlock(p)!
    expect(block).toContain('ש: מחיר לחתונה?')
    expect(block).toContain('escalationTopic=true')
    expect(block).toContain('חם, אדיב ומקצועי')
    expect(block).not.toMatch(/טליסמן/)
  })
})

describe('relationship from CRM evidence only', () => {
  it.each([
    ['closed', 0, true, 'existing_customer'],
    ['interested', 2, true, 'existing_customer'],
    ['lost', 3, true, 'lost'],
    ['new', 0, true, 'prospect'],
    [null, 0, false, 'contact'],
  ] as const)('status %s, %i sales, lead %s → %s', (status, sales, hasLead, expected) => {
    expect(relationshipFrom(status, sales, hasLead)).toBe(expected)
  })

  it('the block is internal, states the appointment exactly, and forbids changing it', () => {
    const c: CrmContext = {
      relationship: 'existing_customer',
      leadStatus: 'closed',
      completedSales: 1,
      lastSaleAtMs: Date.parse('2030-06-01T09:00:00Z'),
      nextMeeting: { startAtMs: Date.parse('2030-11-15T08:30:00Z'), title: 'פגישת תיאום', status: 'scheduled' },
      lastMeeting: null,
    }
    const block = formatCrmContextBlock(c)
    expect(block).toContain('לקוח/ה קיים/ת')
    expect(block).toContain('2030-11-15 10:30') // Jerusalem, never UTC
    expect(block).toContain('אסור לשנות, לבטל או להזיז')
    expect(formatCrmContextBlock({ ...c, relationship: 'lost', nextMeeting: null })).toContain('זה לא לקוח קיים')
  })
})

describe('the layered prompt', () => {
  it('the system prompt keeps every sales rule, scoped to business turns, and adds the truthfulness laws', () => {
    expect(CONVERSATIONAL_SYSTEM_PROMPT).toContain(QUALIFY_SYSTEM_PROMPT)
    expect(CONVERSATIONAL_SYSTEM_PROMPT).toContain('סגנון הוא לא כוונה')
    expect(CONVERSATIONAL_SYSTEM_PROMPT).toContain('לעולם אל תמציא/י עובדות על בעל/ת העסק')
    expect(CONVERSATIONAL_SYSTEM_PROMPT).toContain('לעולם אל תתחייב/י בשם בעל/ת העסק')
    expect(CONVERSATIONAL_SYSTEM_PROMPT).toContain('אל תשקר/י')
  })

  it('the user message carries CRM context, the hint and (on repair) the repair line, then the usual blocks and fenced transcript', () => {
    const crm: CrmContext = { relationship: 'contact', leadStatus: null, completedSales: 0, lastSaleAtMs: null, nextMeeting: null, lastMeeting: null }
    const base = { transcript: [{ direction: 'inbound' as const, text: 'אחי מה קורה?' }], qualification: {}, collectFields: { required: [], optional: [] }, guidance: null }
    const user = buildConversationalUser(base, { crm, memory: mem(), nowMs: NOW })
    expect(user.indexOf('מה SocialCRM יודע')).toBeLessThan(user.indexOf('אחי מה קורה?'))
    expect(user).toContain('רמז מהתור הקודם')
    expect(user).not.toContain('התשובה הקודמת לא נשלחה')
    expect(buildConversationalUser(base, { crm, memory: null, nowMs: NOW, personalRepair: true })).toContain('התשובה הקודמת לא נשלחה')
  })
})

describe('scheduling requests are business, however casually they are said', () => {
  it.each([
    'אחי אפשר לקבוע למחר?',
    'מה קורה, יש לכם מקום בחמישי?',
    'תזיז לי את הפגישה לשבוע הבא',
    'אני רוצה לסגור איתכם תאריך',
    'אפשר לתאם פגישה ליום ראשון?',
    'אתם פנויים ב-15 לחודש?',
    'אפשר לבטל את התור של מחר?',
    'מתי אתם פנויים השבוע?',
    'בא לי לשריין אצלכם את האולם לאוגוסט',
    'יש לכם עדיין תאריך פנוי ביוני?',
    'נקבע פגישה לשבוע הבא?',
    'אחי תקבע לי ל-10',
  ])('%s → scheduling', (text) => {
    expect(isSchedulingRequest(text)).toBe(true)
  })

  it.each([
    'מתגעגע אחי, חייבים להיפגש',
    'חייבים לקבוע',
    'נקבע למחר בערב?',
    'מה אתה עושה מחר?',
    'נצא הערב?',
    'אחי מה קורה?',
    'הפגישה שלנו עדיין בתוקף?',
  ])('%s → not a scheduling request', (text) => {
    expect(isSchedulingRequest(text)).toBe(false)
  })

  it('meeting words without an explicit person request go to the model; a new booking need still needs the team', () => {
    expect(meetingOnlyHandoff('אפשר לקבוע פגישה?')).toBe(true)
    expect(meetingOnlyHandoff('אפשר לדבר עם נציג?')).toBe(false)
    expect(meetingNeedsTeam('scheduling')).toBe(true)
    expect(meetingNeedsTeam('personal')).toBe(false)
    expect(meetingNeedsTeam('existing_customer')).toBe(false)
  })
})
