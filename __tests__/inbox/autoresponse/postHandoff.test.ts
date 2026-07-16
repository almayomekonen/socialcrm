/**
 * Unit tests for the post-handoff responder (pure, no DB/LLM).
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  isPostHandoffEnabled,
  maxPostHandoffMessages,
  detectUrgent,
  buildPostHandoffUser,
  DEFER_VARIANTS,
  deferLine,
  decidePostHandoffReply,
} from '@/lib/inbox/autoresponse/postHandoff'
import { validateConciergeReply } from '@/lib/inbox/autoresponse/validate'

describe('post-handoff flag + budget', () => {
  const KEYS = ['POST_HANDOFF_AGENCY_IDS', 'POST_HANDOFF_KILL', 'MAX_POST_HANDOFF_MESSAGES'] as const
  const saved: Record<string, string | undefined> = {}
  for (const k of KEYS) saved[k] = process.env[k]
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('defaults OFF; honours allowlist and kill', () => {
    delete process.env.POST_HANDOFF_AGENCY_IDS
    delete process.env.POST_HANDOFF_KILL
    expect(isPostHandoffEnabled(103)).toBe(false)
    process.env.POST_HANDOFF_AGENCY_IDS = '103'
    expect(isPostHandoffEnabled(103)).toBe(true)
    expect(isPostHandoffEnabled(104)).toBe(false)
    process.env.POST_HANDOFF_KILL = '1'
    expect(isPostHandoffEnabled(103)).toBe(false)
  })

  it('budget defaults to 3 and clamps invalid values', () => {
    delete process.env.MAX_POST_HANDOFF_MESSAGES
    expect(maxPostHandoffMessages()).toBe(3)
    process.env.MAX_POST_HANDOFF_MESSAGES = '5'
    expect(maxPostHandoffMessages()).toBe(5)
    process.env.MAX_POST_HANDOFF_MESSAGES = '0'
    expect(maxPostHandoffMessages()).toBe(3)
    process.env.MAX_POST_HANDOFF_MESSAGES = '99'
    expect(maxPostHandoffMessages()).toBe(3)
  })
})

describe('detectUrgent', () => {
  it('flags urgency, not neutral text', () => {
    expect(detectUrgent('דחוף! תתקשרו אליי עכשיו')).toBe(true)
    expect(detectUrgent('I need help immediately')).toBe(true)
    expect(detectUrgent('call me now')).toBe(true)
    expect(detectUrgent('תודה רבה')).toBe(false)
    expect(detectUrgent('יש לכם אפליקציה?')).toBe(false)
  })
})

describe('post-handoff prompt + defer variants', () => {
  it('user prompt includes the transcript and the business guidance', () => {
    const u = buildPostHandoffUser({
      transcript: [{ direction: 'inbound', text: 'תודה' }],
      guidance: 'אנחנו חברת פיתוח תוכנה',
    })
    expect(u).toContain('תודה')
    expect(u).toContain('אנחנו חברת פיתוח תוכנה')
  })

  it('every defer variant passes the concierge validator (safe fallback)', () => {
    expect(DEFER_VARIANTS.length).toBeGreaterThan(1)
    for (const v of DEFER_VARIANTS) expect(validateConciergeReply(v).ok).toBe(true)
  })

  it('deferLine rotates the wording (never the same twice in a row)', () => {
    expect(deferLine(0)).toBe(DEFER_VARIANTS[0])
    expect(deferLine(1)).toBe(DEFER_VARIANTS[1])
    expect(deferLine(DEFER_VARIANTS.length)).toBe(DEFER_VARIANTS[0])
    expect(deferLine(0)).not.toBe(deferLine(1))
  })
})

describe('decidePostHandoffReply (pure)', () => {
  const gates = {
    hasUnansweredInbound: true,
    withinWindow: true,
    withinQuietHours: false,
    sentToday: 0,
    dailyCap: 200,
    budgetUsed: 0,
  }
  const okGen = (reply: string, deferred: boolean) => ({ ok: true as const, reply, deferred })

  it('STOP when budget is exhausted (>= max, default 3)', () => {
    const d = decidePostHandoffReply({ ...gates, budgetUsed: 3, gen: okGen('בשמחה!', false) })
    expect(d).toEqual({ action: 'stop', reason: 'budget_exhausted' })
  })

  it('STOP when generation is unavailable', () => {
    const d = decidePostHandoffReply({ ...gates, gen: { ok: false, skipReason: 'ai_unavailable' } })
    expect(d).toEqual({ action: 'stop', reason: 'ai_unavailable' })
  })

  it('STOP on hard gates (no pending / window / quiet / cap)', () => {
    expect(decidePostHandoffReply({ ...gates, hasUnansweredInbound: false, gen: okGen('בשמחה!', false) }).action).toBe('stop')
    expect(decidePostHandoffReply({ ...gates, withinWindow: false, gen: okGen('בשמחה!', false) }).action).toBe('stop')
    expect(decidePostHandoffReply({ ...gates, withinQuietHours: true, gen: okGen('בשמחה!', false) }).action).toBe('stop')
    expect(decidePostHandoffReply({ ...gates, sentToday: 200, gen: okGen('בשמחה!', false) }).action).toBe('stop')
  })

  it('SEND the model reply when valid (answer)', () => {
    const d = decidePostHandoffReply({ ...gates, gen: okGen('בשמחה, נעדכן את הצוות.', false) })
    expect(d).toEqual({ action: 'send', text: 'בשמחה, נעדכן את הצוות.', deferred: false })
  })

  it('SEND the model deferral when it defers with valid wording', () => {
    const d = decidePostHandoffReply({ ...gates, gen: okGen('נציג יחזור אליך בקרוב עם זה.', true) })
    expect(d).toEqual({ action: 'send', text: 'נציג יחזור אליך בקרוב עם זה.', deferred: true })
  })

  it('FALL BACK to a rotating safe defer when the model reply violates the guardrail', () => {
    const d = decidePostHandoffReply({ ...gates, budgetUsed: 1, gen: okGen('המחיר הוא 200 שקל', false) })
    expect(d).toEqual({ action: 'send', text: deferLine(1), deferred: true })
  })

  it('FALL BACK to a safe defer when the model returns empty text', () => {
    const d = decidePostHandoffReply({ ...gates, gen: okGen('   ', false) })
    expect(d).toEqual({ action: 'send', text: deferLine(0), deferred: true })
  })
})
