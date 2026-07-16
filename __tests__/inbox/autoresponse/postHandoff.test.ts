/**
 * Unit tests for the post-handoff responder (pure, no DB/LLM).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { isPostHandoffEnabled, maxPostHandoffMessages, detectUrgent } from '@/lib/inbox/autoresponse/postHandoff'

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
