/**
 * Wave 1 — the lead status transition consumer.
 *
 * `lead_status_transitions` was written and read by nothing. This projects it
 * into narrative `history`, the shape `assembleContext` already puts in the
 * ContextPackage and M5 already receives.
 *
 * The properties under test are the ones that make it context rather than a
 * second event system: it records only real transitions, it preserves actor and
 * source verbatim, it is agency-scoped in SQL, and it can never surface anything.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  agencyTransitionsQuery,
  consumeStatusTransitions,
  transitionToNarrative,
  type StatusTransitionRow,
} from '@/lib/ai/integration/statusTransitionNarrative'

const AT = new Date('2026-08-25T09:00:00.000Z')

const row = (over: Partial<StatusTransitionRow> = {}): StatusTransitionRow => ({
  id: 9001,
  leadId: 77,
  fromStatus: 'new',
  toStatus: 'contacted',
  occurredAt: AT,
  actorUserId: 42,
  source: 'manual',
  ...over,
})

describe('projection into narrative history', () => {
  it('turns a real transition into a history record for the lead', () => {
    const n = transitionToNarrative(103, row())!
    expect(n).toMatchObject({
      agencyId: 103,
      subjectType: 'lead',
      subjectId: '77',
      kind: 'history',
    })
    expect(n.occurredAt).toEqual(AT)
  })

  it('preserves fromStatus, toStatus, actor and source verbatim', () => {
    const n = transitionToNarrative(103, row({ source: 'sale', actorUserId: 7 }))!
    expect(n.content).toEqual({
      event: 'lead.status_changed',
      fromStatus: 'new',
      toStatus: 'contacted',
      actorUserId: 7,
      source: 'sale',
      transitionId: 9001,
    })
  })

  it('keeps a null origin as null — never a fabricated starting status', () => {
    const n = transitionToNarrative(103, row({ fromStatus: null }))!
    expect(n.content.fromStatus).toBeNull()
  })

  it('carries a system actor as null rather than inventing a user', () => {
    const n = transitionToNarrative(103, row({ actorUserId: null, source: 'system' }))!
    expect(n.content.actorUserId).toBeNull()
    expect(n.content.source).toBe('system')
  })

  it('records the real transitions the product defines', () => {
    const pipeline: Array<[string | null, string]> = [
      [null, 'new'],
      ['new', 'contacted'],
      ['contacted', 'interested'],
      ['interested', 'closed'],
      ['interested', 'lost'],
    ]
    for (const [fromStatus, toStatus] of pipeline) {
      const n = transitionToNarrative(103, row({ fromStatus, toStatus }))!
      expect(n.content.fromStatus).toBe(fromStatus)
      expect(n.content.toStatus).toBe(toStatus)
    }
  })
})

describe('malformed rows are skipped, never guessed at', () => {
  it('refuses a row with no destination', () => {
    expect(transitionToNarrative(103, row({ toStatus: '' }))).toBeNull()
    expect(transitionToNarrative(103, row({ toStatus: '   ' }))).toBeNull()
  })

  it('refuses a row with no usable lead', () => {
    for (const leadId of [0, -1, NaN]) {
      expect(transitionToNarrative(103, row({ leadId }))).toBeNull()
    }
  })

  it('refuses a row with an unusable moment rather than defaulting to now', () => {
    expect(transitionToNarrative(103, row({ occurredAt: 'not-a-date' }))).toBeNull()
  })
})

describe('no-op updates never reach this consumer', () => {
  it('relies on the writer, and adds no second no-op rule of its own', () => {
    // `isRecordableTransition` already refuses a write when destination equals
    // origin, so a re-saved status never became a row. A second rule here would
    // be a second authority on the same question.
    const src = readFileSync('lib/ai/integration/statusTransitionNarrative.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ')
    expect(src).not.toContain('isRecordableTransition')
    expect(src).not.toMatch(/fromStatus\s*===\s*.*toStatus/)
  })
})

describe('agency scoping lives in the SQL', () => {
  it('filters and binds the agency', () => {
    const { sql, bindings } = agencyTransitionsQuery(999, 0, 10).toSQL()
    expect(sql).toMatch(/"agencyId"/)
    expect(bindings).toContain(999)
  })

  it('is bounded and ordered oldest-first, so history reads as history', () => {
    const { sql, bindings } = agencyTransitionsQuery(103, 0, 25).toSQL()
    expect(sql).toMatch(/order by "occurredAt" asc/i)
    expect(sql).toMatch(/limit/i)
    expect(bindings).toContain(25)
  })
})

describe('consumeStatusTransitions', () => {
  it('records every valid row and reports the count', async () => {
    const recorder = vi.fn().mockResolvedValue({})
    // The reader's SQL is pinned above; here it is injected so the projection
    // loop is provable without Postgres.
    const reader = async () => [row(), row({ id: 9002, leadId: 78 })]

    const summary = await consumeStatusTransitions({ agencyId: 103 }, { sinceMs: 0, recorder, reader })
    expect(summary.read).toBe(2)
    expect(summary.recorded).toBe(2)
    expect(summary.errored).toBe(0)
    expect(recorder).toHaveBeenCalledTimes(2)
  })

  it('skips a malformed row without failing the pass', async () => {
    const recorder = vi.fn().mockResolvedValue({})
    const reader = async () => [row(), row({ id: 9003, toStatus: '' })]

    const summary = await consumeStatusTransitions({ agencyId: 103 }, { sinceMs: 0, recorder, reader })
    expect(summary.recorded).toBe(1)
    expect(summary.skipped).toBe(1)
    expect(summary.errored).toBe(0)
  })

  it('one failing record never stops the rest', async () => {
    const recorder = vi
      .fn()
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValue({})
    const reader = async () => [row(), row({ id: 9004, leadId: 78 })]

    const summary = await consumeStatusTransitions({ agencyId: 103 }, { sinceMs: 0, recorder, reader })
    expect(summary.errored).toBe(1)
    expect(summary.recorded).toBe(1)
  })

  it('never throws when the read fails — reasoning simply knows less', async () => {
    const reader = async () => {
      throw new Error('db down')
    }
    const summary = await consumeStatusTransitions({ agencyId: 103 }, { sinceMs: 0, reader })
    expect(summary.errored).toBe(1)
    expect(summary.recorded).toBe(0)
  })
})

describe('it is context, never a surface', () => {
  it('cannot notify, enqueue a signal, or send anything', () => {
    const src = readFileSync('lib/ai/integration/statusTransitionNarrative.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ')
    for (const forbidden of ['notifyEvent', 'enqueueSignal', 'sendWhatsapp', 'emitInsight', 'signal_jobs']) {
      expect(src).not.toContain(forbidden)
    }
  })

  it('writes only narrative history — no belief, no insight, no job', () => {
    const src = readFileSync('lib/ai/integration/statusTransitionNarrative.ts', 'utf8')
    expect(src).toContain("kind: 'history'")
    expect(src).not.toContain('writeBelief')
  })
})
