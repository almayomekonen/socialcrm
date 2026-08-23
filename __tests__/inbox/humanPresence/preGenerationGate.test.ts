/**
 * WhatsApp Agent — typing at the pre-generation gate.
 *
 * The cheapest stop: refuse the turn before an AI call is spent. What matters
 * here is the SHAPE of the refusal — `skip`, never `stop`. A `stop` would write
 * a terminal aiState and a rep who started a sentence and thought better of it
 * would have silenced the agent on that conversation for good.
 */
import { describe, expect, it } from 'vitest'
import { decidePreGeneration, type PreFacts } from '@/lib/inbox/autoresponse/stateMachine'

const pre = (over: Partial<PreFacts> = {}): PreFacts => ({
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
  turnCount: 1,
  maxTurns: 5,
  ...over,
})

describe('decidePreGeneration and human presence', () => {
  it('no typing signal → the agent proceeds', () => {
    expect(decidePreGeneration(pre())).toEqual({ action: 'proceed' })
    expect(decidePreGeneration(pre({ humanTyping: false }))).toEqual({ action: 'proceed' })
  })

  it('typing → SKIP this turn (transient), never a terminal stop', () => {
    const d = decidePreGeneration(pre({ humanTyping: true }))
    expect(d).toEqual({ action: 'skip', reason: 'human_typing' })
    // A `stop` decision is what writes a terminal aiState. Typing must not.
    expect(d.action).not.toBe('stop')
  })

  it('typing outranks every policy gate below it', () => {
    // Nothing further down may turn a human-present turn into a different answer.
    expect(
      decidePreGeneration(pre({ humanTyping: true, withinQuietHours: true, sentTodayForAgency: 999 })),
    ).toEqual({ action: 'skip', reason: 'human_typing' })
  })

  it('typing does not pre-empt a completed takeover', () => {
    // A rep who has already sent is HUMAN_ACTIVE; that verdict is the stronger
    // one and must be the reason recorded.
    expect(decidePreGeneration(pre({ humanTyping: true, humanTookOver: true }))).toEqual({
      action: 'stop',
      state: 'human_active',
      reason: 'human_active',
    })
    expect(decidePreGeneration(pre({ aiState: 'human_active', humanTyping: true }))).toEqual({
      action: 'skip',
      reason: 'human_active',
    })
  })

  it('typing pre-empts an explicit handoff request — the rep is already answering', () => {
    expect(decidePreGeneration(pre({ humanTyping: true, humanRequest: true }))).toEqual({
      action: 'skip',
      reason: 'human_typing',
    })
  })

  it('once typing lapses the same facts proceed again', () => {
    const facts = pre({ humanTyping: true })
    expect(decidePreGeneration(facts).action).toBe('skip')
    expect(decidePreGeneration({ ...facts, humanTyping: false })).toEqual({ action: 'proceed' })
  })
})
