/**
 * Wave 1 detector — `conversation.unanswered`. Pure unit tests, no DB, no model.
 *
 * The load-bearing property is the same DEFERENCE its two siblings are held to:
 * this detector must not know what "unanswered" means. `classifyLead` owns the
 * response-window semantic (`isWaitingForReply`), and every exclusion below —
 * an existing human reply, a terminal lead, the whole priority order — is
 * asserted THROUGH it, so a detector that started re-deriving the predicate
 * would fail these tests rather than quietly disagreeing with the Today brief.
 *
 * The second property is that it EXECUTES NOTHING. A detector emits an
 * observation; sending, escalating and surfacing all belong to gates that run
 * far downstream, and none of them is reachable from this module.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  detectConversationUnanswered,
  CONVERSATION_UNANSWERED_EXPECTATION,
} from '@/lib/ai/integration/detectors/conversationUnanswered'
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
import { classifyLead } from '@/lib/today/classify'
import { businessDayBounds } from '@/lib/today/time'
import type { LeadFact } from '@/lib/today/types'
import type { Scope } from '@/db/ai/stateManagement'

const NOW = new Date('2026-08-25T09:00:00.000Z')
const ctx = businessDayBounds(NOW.getTime())
const SCOPE: Scope = { agencyId: 103 }
const HOUR = 3_600_000

/** A lead whose customer wrote two hours ago and who has never been answered. */
function fact(over: Partial<LeadFact> = {}): LeadFact {
  return {
    id: 77,
    name: null,
    phone: null,
    status: 'contacted',
    leadSource: 'whatsapp:wamid.1',
    createdAt: NOW.getTime() - 48 * HOUR,
    nextFollowUpAt: null,
    lastActivityAt: NOW.getTime() - 2 * HOUR,
    lastInboundAt: NOW.getTime() - 2 * HOUR,
    lastHumanOutboundAt: null,
    hasOpenTask: false,
    earliestOpenTaskDueAt: null,
    ...over,
  }
}

describe('positive case', () => {
  it('emits an absence signal for an unanswered customer message', () => {
    const f = fact()
    // Deference: the state really is WAITING_REPLY, and that is why it emits.
    expect(classifyLead(f, ctx)).toBe('WAITING_REPLY')

    const signals = detectConversationUnanswered([f], ctx, SCOPE)
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      signalType: 'absence',
      scope: SCOPE,
      subject: { subjectType: 'lead', subjectId: '77' },
      inferentialDistance: 'low',
      absence: {
        violatedExpectation: CONVERSATION_UNANSWERED_EXPECTATION,
        sinceLastSignalAt: new Date(f.lastInboundAt!).toISOString(),
      },
    })
  })

  it('carries provenance and no customer identity', () => {
    const [signal] = detectConversationUnanswered([fact()], ctx, SCOPE)
    expect(signal.traceRefs).toEqual([{ type: 'lead', id: '77' }])
    // A signal must never carry a name or a phone number.
    expect(JSON.stringify(signal)).not.toMatch(/phone|name/i)
  })

  it('names no deadline, because nothing promised a reply by an instant', () => {
    const [signal] = detectConversationUnanswered([fact()], ctx, SCOPE)
    expect(signal.absence?.expectedBy).toBeUndefined()
  })
})

describe('negative cases — an existing outbound suppresses the signal', () => {
  it('stays silent once a HUMAN has replied after the inbound', () => {
    const f = fact({ lastHumanOutboundAt: NOW.getTime() - HOUR })
    expect(classifyLead(f, ctx)).not.toBe('WAITING_REPLY')
    expect(detectConversationUnanswered([f], ctx, SCOPE)).toEqual([])
  })

  it('STILL fires when only an auto-response replied', () => {
    // `lastHumanOutboundAt` excludes the auto_response marker at the SQL layer,
    // so an AI acknowledgement leaves a human answer owed. Reversing this would
    // let the agent silence the signal that says a person is waiting.
    const f = fact({ lastHumanOutboundAt: null })
    expect(detectConversationUnanswered([f], ctx, SCOPE)).toHaveLength(1)
  })

  it('stays silent for a terminal lead', () => {
    for (const status of ['closed', 'lost']) {
      expect(detectConversationUnanswered([fact({ status })], ctx, SCOPE)).toEqual([])
    }
  })

  it('stays silent when there is no inbound at all', () => {
    expect(detectConversationUnanswered([fact({ lastInboundAt: null })], ctx, SCOPE)).toEqual([])
  })

  it('emits nothing for an empty fact set', () => {
    expect(detectConversationUnanswered([], ctx, SCOPE)).toEqual([])
  })
})

describe('deference to the priority order', () => {
  it('WAITING_REPLY outranks an overdue follow-up, so this detector owns the lead', () => {
    // Both conditions hold. `classifyLead` returns the higher-priority state, so
    // the owed action is the reply — and the overdue detector must stay silent.
    const f = fact({ nextFollowUpAt: NOW.getTime() - 48 * HOUR })
    expect(classifyLead(f, ctx)).toBe('WAITING_REPLY')
    expect(detectConversationUnanswered([f], ctx, SCOPE)).toHaveLength(1)
  })
})

describe('idempotency — the observation key', () => {
  it('is deterministic across calls for the same unanswered message', () => {
    const a = detectConversationUnanswered([fact()], ctx, SCOPE)[0]
    // A later sweep, a different clock: same observation, same key.
    const laterCtx = businessDayBounds(NOW.getTime() + 5 * HOUR)
    const b = detectConversationUnanswered([fact()], laterCtx, SCOPE)[0]
    expect(observationKeyFor(a)).toBe(observationKeyFor(b))
  })

  it('changes when a NEW customer message arrives', () => {
    const a = detectConversationUnanswered([fact()], ctx, SCOPE)[0]
    const b = detectConversationUnanswered([fact({ lastInboundAt: NOW.getTime() - HOUR })], ctx, SCOPE)[0]
    // A new message is genuinely new work, so it must not be deduped away.
    expect(observationKeyFor(a)).not.toBe(observationKeyFor(b))
  })

  it('namespaces the key by expectation and subject', () => {
    const key = observationKeyFor(detectConversationUnanswered([fact()], ctx, SCOPE)[0])
    expect(key.startsWith(`${CONVERSATION_UNANSWERED_EXPECTATION}:lead:77:`)).toBe(true)
  })
})

describe('tenant isolation', () => {
  it('carries the caller-supplied scope verbatim and derives no agency of its own', () => {
    const other: Scope = { agencyId: 999 }
    const [signal] = detectConversationUnanswered([fact()], ctx, other)
    expect(signal.scope).toEqual(other)
    // The storage-level CHECK compares this against signal_jobs."agencyId".
    expect(signal.scope.agencyId).toBe(999)
  })
})

describe('the ratified ingress accepts it', () => {
  it('passes interpret() unchanged', () => {
    const [signal] = detectConversationUnanswered([fact()], ctx, SCOPE)
    const result = interpret(signal)
    expect(result.accepted).toBe(true)
  })
})

describe('registry completeness', () => {
  it('is registered under its own expectation', () => {
    expect(DETECTORS[CONVERSATION_UNANSWERED_EXPECTATION]!.expectation).toBe(CONVERSATION_UNANSWERED_EXPECTATION)
  })

  it('declares the state its violation asserts', () => {
    expect(EXPECTED_STATE[CONVERSATION_UNANSWERED_EXPECTATION]).toBe('WAITING_REPLY')
  })

  it('is OWNED by message.unanswered, so the AI never duplicates the tick', () => {
    expect(NOTIFICATION_OWNERSHIP[CONVERSATION_UNANSWERED_EXPECTATION]).toBe('message.unanswered')
    expect(isOwnedByDeterministicNotification(CONVERSATION_UNANSWERED_EXPECTATION)).toBe(true)
  })

  it('declares a vigilance class that is not a licence to surface', () => {
    expect(VIGILANCE_CLASS[CONVERSATION_UNANSWERED_EXPECTATION]).toBe('cadence_break')
    // Ownership can never be waived by the override.
    expect(isOwnedByDeterministicNotification(CONVERSATION_UNANSWERED_EXPECTATION)).toBe(true)
  })

  it('declares a system-authored objective with no lead data interpolated', () => {
    const objective = objectiveFor(CONVERSATION_UNANSWERED_EXPECTATION)
    expect(objective).toBe(INVESTIGATION_OBJECTIVE[CONVERSATION_UNANSWERED_EXPECTATION])
    expect(objective).not.toMatch(/\$\{|\{\{/)
  })
})

describe('no execution is reachable from the detector', () => {
  it('imports nothing that can send, enqueue or notify', () => {
    const src = readFileSync('lib/ai/integration/detectors/conversationUnanswered.ts', 'utf8')
    for (const forbidden of ['sendWhatsapp', 'notifyEvent', 'enqueue', 'fetch(', 'Date.now()']) {
      expect(src).not.toContain(forbidden)
    }
  })
})
