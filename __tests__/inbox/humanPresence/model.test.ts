/**
 * WhatsApp Agent — Human Presence, the pure state model.
 *
 * The invariant under test: the agent runs autonomously until the human נציג
 * starts typing, and no reply belonging to a turn a human typed into may ever be
 * delivered — while the transient signal itself can never strand a conversation.
 */
import { describe, expect, it } from 'vitest'
import {
  HUMAN_TYPING_TTL_MS,
  authorizeAgentSend,
  classifyHumanPresence,
  humanTypingBlocksTurn,
  isHumanTypingLive,
  shouldCancelGeneration,
  typedDuringTurn,
  type HumanPresenceFacts,
} from '@/lib/inbox/autoresponse/humanPresence'

const T0 = Date.parse('2026-08-23T09:00:00.000Z')
const at = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString()

/** Turn epoch = the job's createdAt. The customer message landed at T0. */
const TURN = at(0)

const facts = (over: Partial<HumanPresenceFacts> = {}): HumanPresenceFacts => ({
  aiState: 'ai_qualifying',
  humanTypingUntil: null,
  humanTypingAt: null,
  now: at(5_000),
  ...over,
})

describe('reading a conversation does not stop the agent', () => {
  it('a conversation nobody has typed in is AI_ACTIVE and authorized', () => {
    const f = facts()
    expect(classifyHumanPresence(f)).toBe('AI_ACTIVE')
    expect(authorizeAgentSend(f, TURN)).toEqual({ authorized: true })
  })

  it('opening a thread writes no presence, so a fresh row stays AI_ACTIVE', () => {
    // A conversation the agent has never touched reads as `new` with null typing
    // — exactly what readHumanPresence returns for a missing row.
    const f = facts({ aiState: 'new' })
    expect(classifyHumanPresence(f)).toBe('AI_ACTIVE')
    expect(authorizeAgentSend(f, TURN).authorized).toBe(true)
  })

  it('an earlier turn the human typed in does not block a later turn', () => {
    // Rep typed at T0+1s during the PREVIOUS turn; the customer has since sent a
    // new message, creating a job at T0+60s. The old keystroke is not this turn's.
    const f = facts({ humanTypingAt: at(1_000), humanTypingUntil: at(1_000 + HUMAN_TYPING_TTL_MS), now: at(70_000) })
    expect(authorizeAgentSend(f, at(60_000))).toEqual({ authorized: true })
  })
})

describe('typing stops the agent', () => {
  it('a live typing TTL blocks the send', () => {
    const f = facts({ humanTypingAt: at(4_000), humanTypingUntil: at(4_000 + HUMAN_TYPING_TTL_MS), now: at(6_000) })
    expect(classifyHumanPresence(f)).toBe('HUMAN_TYPING')
    expect(authorizeAgentSend(f, TURN)).toEqual({ authorized: false, reason: 'human_typing_this_turn' })
  })

  it('typing that began BEFORE this turn but is still live blocks it too', () => {
    // The rep was already mid-sentence when the customer's message arrived.
    const f = facts({ humanTypingAt: at(-2_000), humanTypingUntil: at(-2_000 + HUMAN_TYPING_TTL_MS), now: at(1_000) })
    expect(isHumanTypingLive(f)).toBe(true)
    expect(authorizeAgentSend(f, TURN)).toEqual({ authorized: false, reason: 'human_typing' })
  })

  it('cancellation and authorization agree — the watcher never disagrees with the boundary', () => {
    const typing = facts({ humanTypingAt: at(3_000), humanTypingUntil: at(3_000 + HUMAN_TYPING_TTL_MS), now: at(4_000) })
    expect(shouldCancelGeneration(typing, TURN)).toBe(true)
    expect(shouldCancelGeneration(facts(), TURN)).toBe(false)
  })
})

describe('the critical race: typing during generation', () => {
  it('customer → generate → human types → generate finishes → send is REFUSED', () => {
    // Keystroke at T0+2s; generation returns at T0+9s while the TTL is still live.
    const f = facts({ humanTypingAt: at(2_000), humanTypingUntil: at(2_000 + HUMAN_TYPING_TTL_MS), now: at(9_000) })
    expect(authorizeAgentSend(f, TURN)).toEqual({ authorized: false, reason: 'human_typing_this_turn' })
  })

  it('DELAYED completion: the TTL has long lapsed and the send is STILL refused', () => {
    // This is why a TTL alone is not enough. The rep typed one word at T0+2s and
    // stopped. Generation crawled and returned at T0+90s — the transient signal
    // expired 76 seconds ago, yet this reply belongs to a turn a human entered.
    const f = facts({ humanTypingAt: at(2_000), humanTypingUntil: at(2_000 + HUMAN_TYPING_TTL_MS), now: at(90_000) })
    expect(isHumanTypingLive(f)).toBe(false)
    expect(classifyHumanPresence(f)).toBe('AI_ACTIVE')
    expect(typedDuringTurn(f, TURN)).toBe(true)
    expect(authorizeAgentSend(f, TURN)).toEqual({ authorized: false, reason: 'human_typing_this_turn' })
  })

  it('a keystroke landing exactly on the turn epoch counts as during the turn', () => {
    const f = facts({ humanTypingAt: TURN, humanTypingUntil: at(HUMAN_TYPING_TTL_MS), now: at(60_000) })
    expect(authorizeAgentSend(f, TURN)).toEqual({ authorized: false, reason: 'human_typing_this_turn' })
  })
})

describe('a sent human message is permanent takeover', () => {
  it('HUMAN_ACTIVE blocks with no typing signal at all', () => {
    const f = facts({ aiState: 'human_active' })
    expect(classifyHumanPresence(f)).toBe('HUMAN_ACTIVE')
    expect(authorizeAgentSend(f, TURN)).toEqual({ authorized: false, reason: 'human_active' })
  })

  it('HUMAN_ACTIVE outranks a live typing signal', () => {
    const f = facts({
      aiState: 'human_active',
      humanTypingAt: at(1_000),
      humanTypingUntil: at(1_000 + HUMAN_TYPING_TTL_MS),
      now: at(2_000),
    })
    expect(classifyHumanPresence(f)).toBe('HUMAN_ACTIVE')
    expect(authorizeAgentSend(f, TURN)).toEqual({ authorized: false, reason: 'human_active' })
  })

  it('RETRIES cannot send after takeover — a later turn epoch does not help', () => {
    // A retried job re-enters with a fresh epoch far past the takeover. Permanent
    // means permanent: aiState is checked before anything turn-scoped.
    const f = facts({ aiState: 'human_active', now: at(3_600_000) })
    expect(authorizeAgentSend(f, at(3_599_000))).toEqual({ authorized: false, reason: 'human_active' })
  })

  it('opt-out is refused at the same boundary', () => {
    expect(authorizeAgentSend(facts({ aiState: 'opted_out' }), TURN)).toEqual({
      authorized: false,
      reason: 'opted_out',
    })
  })
})

describe('typing is transient — a disconnect never strands a conversation', () => {
  it('an abandoned tab stops refreshing and the TTL lapses', () => {
    const lastBeat = at(10_000)
    const f = facts({
      humanTypingAt: lastBeat,
      humanTypingUntil: at(10_000 + HUMAN_TYPING_TTL_MS),
      now: at(10_000 + HUMAN_TYPING_TTL_MS + 1),
    })
    expect(isHumanTypingLive(f)).toBe(false)
    expect(classifyHumanPresence(f)).toBe('AI_ACTIVE')
  })

  it('after the disconnect the NEXT customer turn is answered normally', () => {
    // Browser died mid-keystroke at T0+10s. The customer writes again 5 minutes
    // later; that job's epoch is newer than the orphaned marker.
    const f = facts({
      humanTypingAt: at(10_000),
      humanTypingUntil: at(10_000 + HUMAN_TYPING_TTL_MS),
      now: at(300_000 + 1_000),
    })
    expect(authorizeAgentSend(f, at(300_000))).toEqual({ authorized: true })
    expect(classifyHumanPresence(f)).toBe('AI_ACTIVE')
  })

  it('the state never latches: typing alone never produces HUMAN_ACTIVE', () => {
    const f = facts({ humanTypingAt: at(1_000), humanTypingUntil: at(1_000 + HUMAN_TYPING_TTL_MS), now: at(2_000) })
    expect(f.aiState).not.toBe('human_active')
    expect(classifyHumanPresence(f)).toBe('HUMAN_TYPING')
  })
})

describe('malformed presence data cannot silently authorize', () => {
  it('unparseable timestamps are treated as absent, not as live presence', () => {
    const f = facts({ humanTypingUntil: 'not-a-date', humanTypingAt: 'not-a-date' })
    expect(isHumanTypingLive(f)).toBe(false)
    expect(typedDuringTurn(f, TURN)).toBe(false)
  })

  it('an unparseable turn epoch cannot mark a keystroke as belonging to the turn', () => {
    const f = facts({ humanTypingAt: at(1_000) })
    expect(typedDuringTurn(f, 'not-a-date')).toBe(false)
  })
})

describe('the pre-generation gate does not spend an AI call it will then discard', () => {
  it('blocks a turn a keystroke already landed in, even once the TTL lapsed', () => {
    // A job the cron picks up minutes later: typing is long gone, but this turn
    // was displaced. Generating here would only feed the boundary a refusal.
    const f = facts({ humanTypingAt: at(2_000), humanTypingUntil: at(2_000 + HUMAN_TYPING_TTL_MS), now: at(300_000) })
    expect(isHumanTypingLive(f)).toBe(false)
    expect(humanTypingBlocksTurn(f, TURN)).toBe(true)
  })

  it('blocks while a human is present, even from before the turn began', () => {
    const f = facts({ humanTypingAt: at(-2_000), humanTypingUntil: at(-2_000 + HUMAN_TYPING_TTL_MS), now: at(1_000) })
    expect(humanTypingBlocksTurn(f, TURN)).toBe(true)
  })

  it('does not block a clean conversation, or one whose typing belonged to an earlier turn', () => {
    expect(humanTypingBlocksTurn(facts(), TURN)).toBe(false)
    const stale = facts({ humanTypingAt: at(-90_000), humanTypingUntil: at(-90_000 + HUMAN_TYPING_TTL_MS), now: at(1_000) })
    expect(humanTypingBlocksTurn(stale, TURN)).toBe(false)
  })

  it('reports FALSE for takeover and opt-out — those are not typing decisions', () => {
    // They stop the turn through their own branches, with their own reasons and
    // their own state writes. Folding them in here would mislabel a takeover.
    const typing = { humanTypingAt: at(2_000), humanTypingUntil: at(2_000 + HUMAN_TYPING_TTL_MS), now: at(3_000) }
    expect(humanTypingBlocksTurn(facts({ ...typing, aiState: 'human_active' }), TURN)).toBe(false)
    expect(humanTypingBlocksTurn(facts({ ...typing, aiState: 'opted_out' }), TURN)).toBe(false)
    // ...and the boundary still refuses both.
    expect(authorizeAgentSend(facts({ ...typing, aiState: 'human_active' }), TURN).authorized).toBe(false)
    expect(authorizeAgentSend(facts({ ...typing, aiState: 'opted_out' }), TURN).authorized).toBe(false)
  })
})
