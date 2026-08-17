import { describe, it, expect } from 'vitest'
import { decidePreGeneration, decidePostGeneration, type PreFacts, type PostFacts } from '@/lib/inbox/autoresponse/stateMachine'

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

describe('decidePreGeneration', () => {
  it('proceeds in the normal qualifying case', () => {
    expect(decidePreGeneration(pre())).toEqual({ action: 'proceed' })
  })
  it('resumes from dormant on a new inbound', () => {
    expect(decidePreGeneration(pre({ aiState: 'dormant' }))).toEqual({ action: 'proceed' })
  })
  it('engages a new conversation', () => {
    expect(decidePreGeneration(pre({ aiState: 'new', turnCount: 0 }))).toEqual({ action: 'proceed' })
  })

  // Human always wins — unconditionally and first.
  it('HUMAN TAKEOVER stops permanently, even if the feature is off', () => {
    expect(decidePreGeneration(pre({ humanTookOver: true, masterEnabled: false }))).toEqual({
      action: 'stop',
      state: 'human_active',
      reason: 'human_active',
    })
  })
  it('human takeover wins over an otherwise-sendable turn', () => {
    expect(decidePreGeneration(pre({ humanTookOver: true }))).toMatchObject({ action: 'stop', state: 'human_active' })
  })
  it('already human_active → skip', () => {
    expect(decidePreGeneration(pre({ aiState: 'human_active' }))).toEqual({ action: 'skip', reason: 'human_active' })
  })

  // Opt-out.
  it('opt-out stops permanently', () => {
    expect(decidePreGeneration(pre({ optOut: true }))).toEqual({ action: 'stop', state: 'opted_out', reason: 'opt_out' })
  })
  it('already opted_out → skip', () => {
    expect(decidePreGeneration(pre({ aiState: 'opted_out' }))).toEqual({ action: 'skip', reason: 'opted_out' })
  })

  // Gates.
  it('feature off → skip', () => {
    expect(decidePreGeneration(pre({ masterEnabled: false }))).toEqual({ action: 'skip', reason: 'feature_off' })
  })
  it('channel off → skip', () => {
    expect(decidePreGeneration(pre({ channelEnabled: false }))).toEqual({ action: 'skip', reason: 'channel_off' })
  })
  it('already escalated → skip', () => {
    expect(decidePreGeneration(pre({ aiState: 'escalated' }))).toEqual({ action: 'skip', reason: 'already_escalated' })
  })
  it('max turns at the SOFT budget still proceeds; hard ceiling skips', () => {
    expect(decidePreGeneration(pre({ turnCount: 5, maxTurns: 5 }))).toEqual({ action: 'proceed' })
    expect(decidePreGeneration(pre({ turnCount: 7, maxTurns: 5 }))).toEqual({ action: 'skip', reason: 'max_turns' })
  })
  it('A: HANDOFF_REQUEST at the hard ceiling hands off instead of max_turns skip', () => {
    expect(decidePreGeneration(pre({ turnCount: 7, maxTurns: 5, humanRequest: true }))).toEqual({
      action: 'handoff',
      reason: 'human_request',
    })
  })
  it('B: PRODUCT_FIT at the hard ceiling still skips max_turns', () => {
    expect(decidePreGeneration(pre({ turnCount: 7, maxTurns: 5, humanRequest: false }))).toEqual({
      action: 'skip',
      reason: 'max_turns',
    })
  })
  it('already escalated wins over a new human request so we do not hand off twice', () => {
    expect(decidePreGeneration(pre({ aiState: 'escalated', humanRequest: true, turnCount: 7 }))).toEqual({
      action: 'skip',
      reason: 'already_escalated',
    })
  })
  it('no unanswered inbound (turn-taking) → skip', () => {
    expect(decidePreGeneration(pre({ hasUnansweredInbound: false }))).toEqual({ action: 'skip', reason: 'no_pending_inbound' })
  })
  it('outside WhatsApp 24h window → skip', () => {
    expect(decidePreGeneration(pre({ withinWindow: false }))).toEqual({ action: 'skip', reason: 'outside_window' })
  })
  it('quiet hours → skip', () => {
    expect(decidePreGeneration(pre({ withinQuietHours: true }))).toEqual({ action: 'skip', reason: 'quiet_hours' })
  })
  it('daily cap reached → skip', () => {
    expect(decidePreGeneration(pre({ sentTodayForAgency: 200, dailyCap: 200 }))).toEqual({ action: 'skip', reason: 'daily_cap' })
  })
})

const post = (over: Partial<PostFacts> = {}): PostFacts => ({
  hotSignal: false,
  uncertain: false,
  requiredComplete: false,
  turnCount: 1,
  maxTurns: 5,
  ...over,
})

describe('decidePostGeneration', () => {
  it('sends a normal qualifying reply', () => {
    expect(decidePostGeneration(post())).toEqual({ action: 'send' })
  })
  it('LLM hotSignal does not escalate — classifier owns commercial handoff', () => {
    expect(decidePostGeneration(post({ hotSignal: true }))).toEqual({ action: 'send' })
    expect(decidePostGeneration(post({ hotSignal: true, salesMove: 'DISCOVERY' }))).toEqual({ action: 'send' })
    expect(decidePostGeneration(post({ hotSignal: true, salesMove: 'BUYING_SIGNAL' }))).toEqual({ action: 'send' })
  })
  it('explicit HANDOFF_REQUEST is the commercial escalate authority', () => {
    expect(decidePostGeneration(post({ salesMove: 'HANDOFF_REQUEST' }))).toEqual({
      action: 'escalate',
      reason: 'human_request',
    })
    expect(decidePostGeneration(post({ hotSignal: false, salesMove: 'HANDOFF_REQUEST' }))).toEqual({
      action: 'escalate',
      reason: 'human_request',
    })
  })
  it('J: LLM hotSignal=true + classifier DISCOVERY continues', () => {
    expect(decidePostGeneration(post({ hotSignal: true, salesMove: 'DISCOVERY' }))).toEqual({ action: 'send' })
  })
  it('K: LLM-shaped HANDOFF_REQUEST is ignored when classifier is DISCOVERY', () => {
    expect(decidePostGeneration(post({ hotSignal: true, salesMove: 'DISCOVERY' }))).toEqual({ action: 'send' })
  })
  it('model uncertainty does not hand off — keep the conversation going', () => {
    expect(decidePostGeneration(post({ uncertain: true }))).toEqual({ action: 'send' })
  })
  it('required fields complete does not hand off — stating a need is not a human reason', () => {
    expect(decidePostGeneration(post({ requiredComplete: true }))).toEqual({ action: 'send' })
  })
  it('soft budget is not an automatic handoff', () => {
    expect(decidePostGeneration(post({ turnCount: 4, maxTurns: 5 }))).toEqual({ action: 'send' })
  })
  it('can still send on the 4th turn (turnCount 3 of 5)', () => {
    expect(decidePostGeneration(post({ turnCount: 3, maxTurns: 5 }))).toEqual({ action: 'send' })
  })
  it('LLM hotSignal does not take precedence over send when the classifier is not HANDOFF_REQUEST', () => {
    expect(decidePostGeneration(post({ hotSignal: true, requiredComplete: true, turnCount: 4 }))).toEqual({
      action: 'send',
    })
  })
  it('soft maxTurns does not hand off a healthy turn', () => {
    expect(decidePostGeneration(post({ turnCount: 4, maxTurns: 5, salesMove: 'DEEPEN' }))).toEqual({ action: 'send' })
  })
  it('casual acknowledgement at soft maxTurns does not hand off', () => {
    expect(decidePostGeneration(post({ turnCount: 4, maxTurns: 5, salesMove: 'CASUAL_ACKNOWLEDGEMENT' }))).toEqual({
      action: 'send',
    })
  })
})
