import { describe, expect, it } from 'vitest'
import {
  HUMAN_OWNED_STATES,
  NEVER_RESUMABLE_STATES,
  RESUMED_STATE,
  decideReturnToAgent,
  decideTakeOver,
  isHumanOwned,
  isNeverResumable,
  stateAfterAgentTurn,
} from '@/lib/inbox/autoresponse/agentOwnership'
import type { AiState } from '@/lib/inbox/autoresponse/qualification'

/**
 * WHO OWNS A CONVERSATION, and the one door back.
 *
 * Three ways a human comes to own one — they send, they press "take over", or
 * the agent hands off — and exactly one way it returns: a person presses
 * "return to agent". No timer, no sweep, no lifecycle edge.
 */

const ALL_STATES: AiState[] = [
  'new',
  'ai_qualifying',
  'escalated',
  'dormant',
  'opted_out',
  'human_active',
  'closed',
]

describe('taking over', () => {
  it('a rep can claim a conversation the agent is handling', () => {
    expect(decideTakeOver('ai_qualifying')).toEqual({ allowed: true })
    expect(decideTakeOver('new')).toEqual({ allowed: true })
    expect(decideTakeOver('dormant')).toEqual({ allowed: true })
  })

  it('claiming one a human already owns is a no-op, not an error', () => {
    // The rep pressed a button; whether ownership was acquired by sending or by
    // pressing is not a distinction they should have to see.
    for (const s of HUMAN_OWNED_STATES) {
      expect(decideTakeOver(s)).toEqual({ allowed: false, reason: 'already_human_owned' })
    }
  })

  it('refuses on opt-out', () => {
    // Already silent. Taking it over would replace the customer's own stop with
    // a weaker, rep-authored one that "return to agent" could then lift.
    expect(decideTakeOver('opted_out')).toEqual({ allowed: false, reason: 'opted_out' })
  })
})

describe('returning to the agent', () => {
  it('works from the two states a human holds, and only those', () => {
    for (const s of HUMAN_OWNED_STATES) {
      expect(decideReturnToAgent(s), s).toEqual({ allowed: true })
    }
    for (const s of ALL_STATES.filter((x) => !isHumanOwned(x))) {
      expect(decideReturnToAgent(s).allowed, s).toBe(false)
    }
  })

  it('an agent handoff is resumable — the rep finished, the agent can carry on', () => {
    expect(decideReturnToAgent('escalated')).toEqual({ allowed: true })
  })

  it('REFUSES the customer’s own stop, and a finished conversation', () => {
    expect(decideReturnToAgent('opted_out')).toEqual({ allowed: false, reason: 'opted_out' })
    expect(decideReturnToAgent('closed')).toEqual({ allowed: false, reason: 'closed' })
    for (const s of NEVER_RESUMABLE_STATES) expect(isNeverResumable(s), s).toBe(true)
  })

  it('returns to ai_qualifying, never to new', () => {
    // `new` would re-arm the first-contact greeting and welcome a customer to a
    // business they are twenty messages into talking to.
    expect(RESUMED_STATE).toBe('ai_qualifying')
  })

  it('resuming something already the agent’s is a no-op', () => {
    expect(decideReturnToAgent('ai_qualifying')).toEqual({ allowed: false, reason: 'already_active' })
  })
})

/**
 * THE RESURRECTION PATH. `recordTurn` wrote `aiState = 'ai_qualifying'`
 * unconditionally, so recording a turn against a human-owned, opted-out or
 * closed conversation handed it straight back to the agent.
 *
 * Nothing reaches recordTurn in those states today, because decidePreGeneration
 * stops first. That is exactly what made it invisible — and exactly one
 * reordering away from the agent speaking over a rep, or messaging a customer
 * who had asked us to stop.
 */
describe('recording an agent turn does not resurrect the agent', () => {
  it('leaves every state a human or the customer owns alone', () => {
    for (const s of [...HUMAN_OWNED_STATES, ...NEVER_RESUMABLE_STATES]) {
      expect(stateAfterAgentTurn(s), `${s} was handed back to the agent`).toBeNull()
    }
  })

  it('still keeps an ordinary conversation qualifying', () => {
    expect(stateAfterAgentTurn('ai_qualifying')).toBe('ai_qualifying')
    expect(stateAfterAgentTurn('new')).toBe('ai_qualifying')
    expect(stateAfterAgentTurn('dormant')).toBe('ai_qualifying')
  })

  it('a conversation with no row yet starts qualifying', () => {
    expect(stateAfterAgentTurn(null)).toBe('ai_qualifying')
    expect(stateAfterAgentTurn(undefined)).toBe('ai_qualifying')
  })

  it('there is no state from which a turn both records AND resumes ownership', () => {
    // The invariant, stated over the whole state space rather than examples.
    for (const s of ALL_STATES) {
      const next = stateAfterAgentTurn(s)
      if (isHumanOwned(s) || isNeverResumable(s)) expect(next, s).toBeNull()
      else expect(next, s).toBe('ai_qualifying')
    }
  })
})

/**
 * Opening a conversation is not ownership. The composer's typing signal is wired
 * to `onChange` and nothing else — not focus, not mount, not scroll, not read —
 * and typing writes only the transient TTL columns, never `aiState`.
 *
 * Asserted against the source, because the defect this prevents is someone
 * adding `onFocus={signalTyping}` in a later refactor and silently turning
 * "I opened the thread to look" into "the agent is off forever".
 */
describe('merely opening a conversation transfers nothing', () => {
  it('the typing hook is bound to typing, not to focus or mount', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(process.cwd(), 'modules/inbox/client/useComposerTypingSignal.ts'), 'utf8')
    expect(src).toContain('Opening a conversation')
    expect(src).not.toMatch(/onFocus|onMount|onScroll|addEventListener\(\s*['"]focus/)
  })

  it('every call site passes it to onChange', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    for (const file of [
      'components/summary/WhatsappReplyDraft.tsx',
      'modules/inbox/mobile/ConversationThreadMobile.tsx',
    ]) {
      const src = readFileSync(join(process.cwd(), file), 'utf8')
      const callsIt = src.includes('signalTyping()')
      expect(callsIt, file).toBe(true)
      // The signal must not be attached to focus/blur anywhere.
      expect(src, file).not.toMatch(/onFocus=\{[^}]*signalTyping/)
    }
  })

  it('the presence writer never touches aiState', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(process.cwd(), 'db/conversationHumanPresence.ts'), 'utf8')
    const recordFn = src.slice(src.indexOf('export async function recordHumanTyping'), src.indexOf('markHumanActiveByConversation'))
    expect(recordFn).not.toContain('aiState')
  })
})
