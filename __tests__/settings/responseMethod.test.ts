import { describe, expect, it } from 'vitest'
import { aiConversational, checkMethodChange, methodWrite, storedMethod } from '@/lib/inbox/autoresponse/responseMethod'
import { resolveResponderChoice, type ResponderChoiceInput } from '@/lib/inbox/autoresponse/responderChoice'

/** The 3-way response method, pure: what each stored row reads as, what each choice writes, and what the save refuses. */

const row = (over: Partial<ResponderChoiceInput> = {}): ResponderChoiceInput => ({
  responder: 'agent',
  mode: 'qualify',
  replyMode: 'ai',
  questionnaireAllowed: true,
  questionnairePublished: true,
  ...over,
})
const read = (r: ResponderChoiceInput) => storedMethod(resolveResponderChoice(r), r.replyMode)

describe('the stored row reads as one method', () => {
  it.each([
    [row(), 'ai'],
    [row({ mode: 'acknowledge', replyMode: 'ai' }), 'ai'],
    [row({ mode: 'acknowledge', replyMode: 'fixed' }), 'fixed'],
    [row({ responder: 'questionnaire', replyMode: 'fixed', mode: 'acknowledge' }), 'questionnaire'],
    // The worker ignores replyMode in qualify mode: that row is the agent.
    [row({ mode: 'qualify', replyMode: 'fixed' }), 'ai'],
  ] as const)('%o → %s', (r, expected) => {
    expect(read(r)).toBe(expected)
  })

  it('no settings row yet: the reply style default', () => {
    expect(storedMethod(null, null)).toBe('ai')
  })
})

describe('what each choice writes', () => {
  it('fixed: the agent, a fixed reply, acknowledge mode', () => {
    expect(methodWrite('fixed', false)).toEqual({ responder: 'agent', replyMode: 'fixed', mode: 'acknowledge' })
  })
  it('ai: conversational for the Smart Reply rollout, otherwise mode is left alone', () => {
    expect(methodWrite('ai', true)).toEqual({ responder: 'agent', replyMode: 'ai', mode: 'qualify' })
    expect(methodWrite('ai', false)).toEqual({ responder: 'agent', replyMode: 'ai' })
  })
  it('questionnaire: only the responder — the agent comes back as it was', () => {
    expect(methodWrite('questionnaire', true)).toEqual({ responder: 'questionnaire' })
  })
  it('the AI is a conversation when the row already is, or the rollout makes it one', () => {
    expect(aiConversational('qualify', false)).toBe(true)
    expect(aiConversational('acknowledge', true)).toBe(true)
    expect(aiConversational('acknowledge', false)).toBe(false)
  })
})

describe('what the save refuses', () => {
  it("questionnaire → fixed when mode was 'acknowledge' is allowed (the old switch refused it)", () => {
    expect(checkMethodChange(row({ responder: 'questionnaire', mode: 'acknowledge' }), { from: 'questionnaire', to: 'fixed' })).toEqual({ ok: true })
  })
  it('stale: the page showed a different stored method', () => {
    expect(checkMethodChange(row({ responder: 'questionnaire' }), { from: 'ai', to: 'fixed' })).toEqual({ ok: false, reason: 'conflict' })
  })
  it('the questionnaire needs a published copy and the agency flag', () => {
    expect(checkMethodChange(row({ questionnairePublished: false }), { from: 'ai', to: 'questionnaire' })).toEqual({ ok: false, reason: 'unavailable' })
    expect(checkMethodChange(row({ questionnaireAllowed: false }), { from: 'ai', to: 'questionnaire' })).toEqual({ ok: false, reason: 'unavailable' })
  })
  it('no settings row: the questionnaire is refused, the AI and a fixed message are not', () => {
    expect(checkMethodChange(null, { from: 'ai', to: 'questionnaire' })).toEqual({ ok: false, reason: 'unavailable' })
    expect(checkMethodChange(null, { from: 'ai', to: 'fixed' })).toEqual({ ok: true })
  })
  it('a stalled questionnaire can stay selected (re-saving other settings)', () => {
    expect(checkMethodChange(row({ responder: 'questionnaire', questionnairePublished: false }), { from: 'questionnaire', to: 'questionnaire' })).toEqual({ ok: true })
  })
})
