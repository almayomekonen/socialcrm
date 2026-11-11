import { describe, expect, it } from 'vitest'
import { canSwitchResponder, resolveResponderChoice, type ResponderChoiceInput } from '@/lib/inbox/autoresponse/responderChoice'

/**
 * Which response method is active and which can be chosen, for every
 * configuration Production actually has (read-only inventory, 2026-11-10).
 * "AI agent" must always mean the multi-turn agent, never one reply.
 */
const base: ResponderChoiceInput = { responder: 'agent', mode: 'qualify', replyMode: 'ai', questionnaireAllowed: true, questionnairePublished: false }
const choice = (over: Partial<ResponderChoiceInput>) => resolveResponderChoice({ ...base, ...over })

describe('the configurations Production has', () => {
  it('64 / 69 — agent in qualify mode, nothing published: agent active, questionnaire needs publishing', () => {
    const c = choice({})
    expect(c).toMatchObject({ stored: 'agent', active: 'agent', current: 'agent', agent: { available: true } })
    expect(c.questionnaire).toEqual({ available: false, reason: 'questionnaire_not_published' })
    expect(canSwitchResponder(c, 'questionnaire')).toBe(false)
  })

  it('103 — agent in qualify mode with a published questionnaire: both selectable, agent active', () => {
    const c = choice({ questionnairePublished: true })
    expect(c.active).toBe('agent')
    expect(canSwitchResponder(c, 'questionnaire')).toBe(true)
    expect(canSwitchResponder(c, 'agent')).toBe(false) // already active
  })

  it('23 — questionnaire, stored mode qualify: questionnaire active, agent selectable', () => {
    const c = choice({ responder: 'questionnaire', questionnairePublished: true })
    expect(c).toMatchObject({ stored: 'questionnaire', active: 'questionnaire', current: 'questionnaire', questionnaireStalled: false })
    expect(canSwitchResponder(c, 'agent')).toBe(true)
  })

  it('158 — questionnaire with acknowledge + fixed underneath: the AI agent is NOT offered', () => {
    const c = choice({ responder: 'questionnaire', mode: 'acknowledge', replyMode: 'fixed', questionnairePublished: true })
    expect(c.active).toBe('questionnaire')
    expect(c.agent).toEqual({ available: false, reason: 'agent_not_conversational' })
    expect(canSwitchResponder(c, 'agent')).toBe(false)
  })

  it.each([
    ['149 / 167 — one AI reply', 'ai', 'one_ai_reply'],
    ['one fixed message', 'fixed', 'one_fixed_reply'],
  ] as const)('%s: no card is shown as active and the agent is unavailable', (_l, replyMode, current) => {
    const c = choice({ mode: 'acknowledge', replyMode })
    expect(c).toMatchObject({ stored: 'agent', active: null, current })
    expect(c.agent).toEqual({ available: false, reason: 'agent_not_conversational' })
  })
})

describe('the questionnaire option is independent of the agent', () => {
  it('rollout off → not enabled, whatever is published', () => {
    expect(choice({ questionnaireAllowed: false, questionnairePublished: true }).questionnaire).toEqual({
      available: false,
      reason: 'questionnaire_not_enabled',
    })
  })

  it('a one-reply agency can still choose a published questionnaire', () => {
    const c = choice({ mode: 'acknowledge', questionnairePublished: true })
    expect(canSwitchResponder(c, 'questionnaire')).toBe(true)
  })

  it('stored questionnaire that cannot speak is still shown as the stored choice, marked stalled', () => {
    const c = choice({ responder: 'questionnaire', questionnairePublished: false })
    expect(c).toMatchObject({ active: 'questionnaire', questionnaireStalled: true })
  })
})

describe('the stored value is read the way the worker reads it', () => {
  it.each([null, undefined, '', 'agent', 'weird'])('responder %j is the agent', (responder) => {
    expect(choice({ responder }).stored).toBe('agent')
  })
  it('mode other than qualify is not conversational', () => {
    expect(choice({ mode: null }).agent.available).toBe(false)
  })
})
