/**
 * Wave 1 detectors — `conversation.objection` and `conversation.stalled`.
 *
 * These are the first detectors that read what was SAID rather than what the
 * lead row looks like. Two properties carry the design and are asserted here:
 *
 *   1. NO RE-CLASSIFICATION. The objection detector consumes a verdict
 *      `salesIntent.ts` already reached and `conversation_turn_classification`
 *      already stored. A second classifier would be a second authority on the
 *      same question, drifting the first time either changed.
 *   2. CONSERVATISM. A stall is not "old". It requires engagement, an answer,
 *      silence since, and nothing scheduled — all four, or nothing is emitted.
 *      False negatives are the intended failure mode.
 *
 * The SQL-shape assertions below pin the tenant predicates and the four stall
 * conditions with `.toSQL()`, the pattern this repo already uses for readers
 * that must be provable without a database.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  detectConversationObjection,
  CONVERSATION_OBJECTION_EXPECTATION,
} from '@/lib/ai/integration/detectors/conversationObjection'
import {
  detectConversationStalled,
  CONVERSATION_STALLED_EXPECTATION,
} from '@/lib/ai/integration/detectors/conversationStalled'
import { DETECTORS } from '@/lib/ai/integration/detectors/registry'
import {
  NOTIFICATION_OWNERSHIP,
  VIGILANCE_CLASS,
  isOwnedByDeterministicNotification,
} from '@/lib/ai/integration/notificationOwnership'
import { INVESTIGATION_OBJECTIVE, objectiveFor } from '@/lib/ai/integration/investigationObjective'
import { EXPECTED_STATE } from '@/lib/ai/integration/preconditions'
import { interpret } from '@/lib/ai/runtime/eventInterpretation'
import { observationKeyFor } from '@/lib/ai/integration/observationKey'
import { businessDayBounds } from '@/lib/today/time'
import {
  agencyObjectionTurnsQuery,
  agencyStalledConversationsQuery,
  NO_CONVERSATION_FACTS,
  ENGAGEMENT_MOVES,
  type ConversationFacts,
} from '@/db/ai/conversationFacts'
import type { Scope } from '@/db/ai/stateManagement'

const NOW = new Date('2026-08-25T09:00:00.000Z')
const ctx = businessDayBounds(NOW.getTime())
const SCOPE: Scope = { agencyId: 103 }

/**
 * A module's CODE, with comments removed — the same helper
 * `signalSubstrate.test.ts` uses, and for the same reason.
 *
 * These detectors DOCUMENT what they must never do ("it does not re-classify",
 * "re-detected every minute, enqueued once"), so a scanner run over raw text
 * flags the prose written to prevent the very thing it looks for. The boundary
 * being asserted is about behaviour, so the assertion reads behaviour.
 */
function codeOf(rel: string): string {
  return readFileSync(rel, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
}

const objectionTurn = (over = {}) => ({
  conversationId: 55,
  leadId: 77,
  triggerSequence: 12,
  classifiedAt: NOW.getTime() - 3_600_000,
  ...over,
})

const stalledConv = (over = {}) => ({
  conversationId: 55,
  leadId: 77,
  triggerSequence: 12,
  salesMove: 'BUYING_SIGNAL',
  engagedAt: NOW.getTime() - 4 * 86_400_000,
  ...over,
})

const facts = (over: Partial<ConversationFacts> = {}): ConversationFacts => ({
  objections: [],
  stalled: [],
  ...over,
})

// ───────────────────────────── objection ─────────────────────────────────────

describe('conversation.objection — positive case', () => {
  it('emits one observation for a persisted OBJECTION turn', () => {
    const signals = detectConversationObjection([], ctx, SCOPE, facts({ objections: [objectionTurn()] }))
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      signalType: 'message',
      scope: SCOPE,
      subject: { subjectType: 'lead', subjectId: '77' },
      inferentialDistance: 'low',
      source: { kind: 'system', id: `detector:${CONVERSATION_OBJECTION_EXPECTATION}` },
    })
  })

  it('links to the conversation, the turn and the lead — and carries no message text', () => {
    const [s] = detectConversationObjection([], ctx, SCOPE, facts({ objections: [objectionTurn()] }))
    expect(s.traceRefs).toEqual([
      { type: 'conversation', id: '55' },
      { type: 'turn', id: '12' },
      { type: 'lead', id: '77' },
    ])
    // Evidence is WHICH turn, never what was said.
    expect(JSON.stringify(s)).not.toMatch(/text|body|message"\s*:/i)
  })

  it('is an observation, not an absence — nothing was violated', () => {
    const [s] = detectConversationObjection([], ctx, SCOPE, facts({ objections: [objectionTurn()] }))
    expect(s.signalType).toBe('message')
    expect(s.absence).toBeUndefined()
  })
})

describe('conversation.objection — negative and idempotency', () => {
  it('emits nothing when there are no classified objections', () => {
    expect(detectConversationObjection([], ctx, SCOPE, NO_CONVERSATION_FACTS)).toEqual([])
  })

  it('one classified turn is exactly one signal', () => {
    const signals = detectConversationObjection([], ctx, SCOPE, facts({ objections: [objectionTurn()] }))
    expect(signals).toHaveLength(1)
  })

  it('the observation key is stable across sweeps for the same turn', () => {
    const a = detectConversationObjection([], ctx, SCOPE, facts({ objections: [objectionTurn()] }))[0]
    const later = businessDayBounds(NOW.getTime() + 6 * 3_600_000)
    const b = detectConversationObjection([], later, SCOPE, facts({ objections: [objectionTurn()] }))[0]
    expect(observationKeyFor(a)).toBe(observationKeyFor(b))
  })

  it('a different turn in the same conversation is a different observation', () => {
    const a = detectConversationObjection([], ctx, SCOPE, facts({ objections: [objectionTurn()] }))[0]
    const b = detectConversationObjection(
      [],
      ctx,
      SCOPE,
      facts({ objections: [objectionTurn({ triggerSequence: 19 })] }),
    )[0]
    expect(observationKeyFor(a)).not.toBe(observationKeyFor(b))
  })

  it('never re-runs the classifier', () => {
    const src = codeOf('lib/ai/integration/detectors/conversationObjection.ts')
    for (const forbidden of ['salesIntent', 'classifySalesTurn', 'RegExp', 'OBJECTION_RE']) {
      expect(src).not.toContain(forbidden)
    }
  })
})

// ───────────────────────────── stalled ───────────────────────────────────────

describe('conversation.stalled — positive case', () => {
  it('emits an absence for an engaged conversation that stopped', () => {
    const signals = detectConversationStalled([], ctx, SCOPE, facts({ stalled: [stalledConv()] }))
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      signalType: 'absence',
      subject: { subjectType: 'lead', subjectId: '77' },
      inferentialDistance: 'medium',
      absence: {
        violatedExpectation: CONVERSATION_STALLED_EXPECTATION,
        sinceLastSignalAt: new Date(stalledConv().engagedAt).toISOString(),
      },
    })
  })

  it('names no deadline — nobody ever wrote a date down', () => {
    const [s] = detectConversationStalled([], ctx, SCOPE, facts({ stalled: [stalledConv()] }))
    expect(s.absence?.expectedBy).toBeUndefined()
  })
})

describe('conversation.stalled — negative and idempotency', () => {
  it('emits nothing without engaged, stalled conversations', () => {
    expect(detectConversationStalled([], ctx, SCOPE, NO_CONVERSATION_FACTS)).toEqual([])
  })

  it('is stable across sweeps for the same engaged turn', () => {
    const a = detectConversationStalled([], ctx, SCOPE, facts({ stalled: [stalledConv()] }))[0]
    const later = businessDayBounds(NOW.getTime() + 8 * 3_600_000)
    const b = detectConversationStalled([], later, SCOPE, facts({ stalled: [stalledConv()] }))[0]
    expect(observationKeyFor(a)).toBe(observationKeyFor(b))
  })

  it('a later engaged turn that stalls again is NEW work, not a duplicate', () => {
    const a = detectConversationStalled([], ctx, SCOPE, facts({ stalled: [stalledConv()] }))[0]
    const b = detectConversationStalled(
      [],
      ctx,
      SCOPE,
      facts({ stalled: [stalledConv({ engagedAt: NOW.getTime() - 86_400_000 })] }),
    )[0]
    expect(observationKeyFor(a)).not.toBe(observationKeyFor(b))
  })

  it('is not an age check — no elapsed-time threshold exists in the module', () => {
    const src = codeOf('lib/ai/integration/detectors/conversationStalled.ts')
    expect(src).not.toMatch(/\d+\s*\*\s*86_?400_?000/)
    expect(src).not.toContain('Date.now()')
  })
})

// ───────────────────────── the four stall conditions, in SQL ─────────────────

describe('the stalled reader requires all four conditions', () => {
  const sql = agencyStalledConversationsQuery(103, 'pro', NOW.getTime() - 86_400_000).toSQL().sql

  it('1 · only commercial engagement moves', () => {
    expect(sql).toMatch(/"t"\."salesMove" in \(/i)
  })

  it('2 · the qualifier answered it — an escalated turn is a human’s open item', () => {
    expect(sql).toMatch(/"t"\."decision"/i)
  })

  it('3 · no customer message since the answered turn', () => {
    expect(sql).toMatch(/not exists/i)
    expect(sql).toMatch(/m\."conversationId" = t\."conversationId"/)
    expect(sql).toMatch(/m\.sequence > t\."triggerSequence"/)
  })

  it('4 · nothing scheduled — no follow-up and no open task', () => {
    expect(sql).toMatch(/"c"\."nextFollowUpAt" is null/i)
    expect(sql).toMatch(/tk\."clientId" = c\.id/)
  })

  it('excludes draft (canary) turns, which never reached a customer', () => {
    expect(sql).toMatch(/"t"\."draft"/i)
  })
})

describe('tenant isolation and plan gating are in the SQL, not in the caller', () => {
  it('both readers filter the agency on BOTH joined tables', () => {
    for (const q of [
      agencyObjectionTurnsQuery(103, 'pro', 0).toSQL().sql,
      agencyStalledConversationsQuery(103, 'pro', 0).toSQL().sql,
    ]) {
      expect(q).toMatch(/"t"\."agencyId"/)
      expect(q).toMatch(/"c"\."agencyId"/)
    }
  })

  it('binds the agency id rather than interpolating it', () => {
    const { bindings } = agencyObjectionTurnsQuery(999, 'pro', 0).toSQL()
    expect(bindings).toContain(999)
  })

  it('excludes terminal leads, matching leadFacts', () => {
    const sql = agencyObjectionTurnsQuery(103, 'pro', 0).toSQL().sql
    expect(sql).toMatch(/"c"\."status" not in/i)
  })

  it('hides over-quota leads on the free plan only', () => {
    expect(agencyObjectionTurnsQuery(103, 'free', 0).toSQL().sql).toMatch(/"c"\."overQuota"/)
    expect(agencyObjectionTurnsQuery(103, 'pro', 0).toSQL().sql).not.toMatch(/"c"\."overQuota"/)
  })

  /**
   * Wave 1.1A INVERTED this. Wave 1 filtered Contacts out because
   * `signal_jobs."subjectType"` could not represent them; now it can, and a
   * leadless turn produces a `conversation` subject instead of being dropped.
   * The tenant boundary is unchanged — it was never the lead join.
   */
  it('reads Contact turns too, with the agency boundary on the classification row', () => {
    const sql = agencyObjectionTurnsQuery(103, 'pro', 0).toSQL().sql
    expect(sql).not.toMatch(/"t"\."leadId" is not null/i)
    expect(sql).toMatch(/"t"\."agencyId"/)
    expect(sql).toMatch(/left join "clients"/i)
  })
})

// ───────────────────────── shared contract assertions ────────────────────────

describe('both detectors satisfy the ratified ingress and the registries', () => {
  const cases = [
    {
      expectation: CONVERSATION_OBJECTION_EXPECTATION,
      signal: detectConversationObjection([], ctx, SCOPE, facts({ objections: [objectionTurn()] }))[0],
      owned: null,
      vigilance: null,
      state: null,
    },
    {
      expectation: CONVERSATION_STALLED_EXPECTATION,
      signal: detectConversationStalled([], ctx, SCOPE, facts({ stalled: [stalledConv()] }))[0],
      owned: null,
      vigilance: 'cadence_break',
      state: null,
    },
  ] as const

  for (const c of cases) {
    it(`${c.expectation} · interpret() accepts it`, () => {
      expect(interpret(c.signal).accepted).toBe(true)
    })

    it(`${c.expectation} · is registered and declared in all four maps`, () => {
      expect(DETECTORS[c.expectation]!.expectation).toBe(c.expectation)
      expect(NOTIFICATION_OWNERSHIP[c.expectation]).toBe(c.owned)
      expect(VIGILANCE_CLASS[c.expectation]).toBe(c.vigilance)
      expect(EXPECTED_STATE[c.expectation]).toBe(c.state)
      expect(objectiveFor(c.expectation)).toBe(INVESTIGATION_OBJECTIVE[c.expectation])
    })

    it(`${c.expectation} · is NOT owned, so it may reach investigation`, () => {
      // These are the first expectations nothing deterministic delivers.
      expect(isOwnedByDeterministicNotification(c.expectation)).toBe(false)
    })

    it(`${c.expectation} · carries the caller scope verbatim (tenant isolation)`, () => {
      expect(c.signal.scope).toEqual(SCOPE)
    })
  }

  it('neither detector can execute anything', () => {
    for (const f of ['conversationObjection', 'conversationStalled']) {
      const src = codeOf(`lib/ai/integration/detectors/${f}.ts`)
      for (const forbidden of ['sendWhatsapp', 'notifyEvent', 'enqueue', 'fetch(', 'db(']) {
        expect(src).not.toContain(forbidden)
      }
    }
  })

  it('the engagement vocabulary is a closed, commercial set', () => {
    expect([...ENGAGEMENT_MOVES]).toEqual(['BUYING_SIGNAL', 'OBJECTION', 'PRODUCT_QUESTION', 'PRODUCT_FIT'])
  })
})
