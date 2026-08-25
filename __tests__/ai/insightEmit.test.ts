/**
 * Phase 4.4 — emission, gating, ownership and the cap. Pure; deps injected.
 *
 * The DB invariants live in `__tests__/runtime/insights.test.ts`. What is proven
 * here is the POLICY: that a conclusion is always recorded, that delivery is a
 * separate gated attempt, that the cap holds without losing anything, and that an
 * insight can never reach someone whose permissions did not bound its evidence.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { emitInsight } from '@/lib/ai/integration/insightEmit'
import { INSIGHT_DAILY_CAP, isInsightDeliveryEnabled, isInsightDeliveryKilled } from '@/lib/ai/integration/insightFlags'
import { getNotificationType } from '@/lib/notifications/registry'
import { NOTIFICATION_TYPES } from '@/lib/notifications/types'
import { isOwnedByDeterministicNotification as realIsOwned } from '@/lib/ai/integration/notificationOwnership'

const AGENCY = 9901
const NOW = new Date('2026-08-25T10:00:00.000Z')
const KEYS = ['SIGNAL_INSIGHT_DELIVER_AGENCY_IDS', 'SIGNAL_INSIGHT_KILL', 'NOTIFICATIONS_AGENCY_ALLOWLIST'] as const
afterEach(() => {
  for (const k of KEYS) delete process.env[k]
  vi.restoreAllMocks()
})

const open = () => {
  process.env.SIGNAL_INSIGHT_DELIVER_AGENCY_IDS = String(AGENCY)
  process.env.NOTIFICATIONS_AGENCY_ALLOWLIST = String(AGENCY)
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 1,
  agencyId: AGENCY,
  insightKey: 'lead:100:cadence.break',
  subjectType: 'lead' as const,
  subjectId: '100',
  expectation: 'cadence.break',
  investigationId: 'inv_1',
  operatorUserId: 42,
  headline: 'h',
  claims: [],
  evidence: [],
  reasoningChain: [],
  decisionTrace: [],
  status: 'open' as const,
  supersededById: null,
  resolvedReason: null,
  notificationJobId: null,
  deliveredAt: null,
  closedAt: null,
  createdAt: NOW.toISOString(),
  ...over,
})

const deps = (over: Record<string, unknown> = {}) => ({
  createInsight: vi.fn(async () => ({ created: true as const, row: row(), supersededId: null })),
  closeInsight: vi.fn(async () => true),
  markDelivered: vi.fn(async () => true),
  deliveredCountForDay: vi.fn(async () => 0),
  notifyEvent: vi.fn(async () => ({ enqueued: true as const, jobId: 88 })),
  buildRecipientContext: vi.fn(async () => ({
    handlerByLead: new Map([[`${AGENCY}:100`, 42]]),
    adminsByAgency: new Map([[AGENCY, [7, 9]]]),
  })),
  // `cadence.break` stands in for a future DECLARED-but-unowned detector. With
  // today's registry every expectation is owned or undeclared, so without this
  // the unowned path is unreachable — see the emitter's fail-closed note.
  isOwnedByDeterministicNotification: vi.fn(() => false),
  ...over,
})

const input = {
  agencyId: AGENCY,
  subjectId: '100',
  expectation: 'cadence.break',
  investigationId: 'inv_1',
  operatorUserId: 42,
  headline: 'h',
  claims: [],
  evidence: [],
  reasoningChain: [],
  decisionTrace: [],
}

// ───────────── C13 · dark by default ─────────────

describe('C13 · everything is dark by default', () => {
  it('the registry entry ships disabled', () => {
    const def = getNotificationType('lead.insight')
    expect(def).toBeDefined()
    expect(def!.enabled).toBe(false)
  })

  it('C14 · the entry declares NO escalation ladder', () => {
    const def = getNotificationType('lead.insight')!
    expect(def.escalation).toBeUndefined()
    expect('escalation' in def).toBe(false)
  })

  it('the delivery gate is off when unset, and refuses "all"', () => {
    expect(isInsightDeliveryEnabled(AGENCY)).toBe(false)
    process.env.SIGNAL_INSIGHT_DELIVER_AGENCY_IDS = 'all'
    expect(isInsightDeliveryEnabled(AGENCY)).toBe(false)
    process.env.SIGNAL_INSIGHT_DELIVER_AGENCY_IDS = String(AGENCY)
    expect(isInsightDeliveryEnabled(AGENCY)).toBe(true)
    expect(isInsightDeliveryEnabled(12345)).toBe(false)
  })

  it('the kill switch fails closed and beats the allowlist', () => {
    process.env.SIGNAL_INSIGHT_DELIVER_AGENCY_IDS = String(AGENCY)
    for (const v of ['1', 'true']) {
      process.env.SIGNAL_INSIGHT_KILL = v
      expect(isInsightDeliveryKilled()).toBe(true)
      expect(isInsightDeliveryEnabled(AGENCY)).toBe(false)
    }
  })

  it('with the gate off the conclusion is STILL recorded, just not delivered', async () => {
    const d = deps()
    const r = await emitInsight(input, { now: NOW, deps: d as never })
    expect(r.outcome).toBe('held_gate_off')
    expect(d.createInsight).toHaveBeenCalledTimes(1) // the conclusion is not lost
    expect(d.notifyEvent).not.toHaveBeenCalled()
    expect(d.closeInsight).not.toHaveBeenCalled() // and not resolved either
  })
})

// ───────────── C6 · Condition 13 ─────────────

describe('C6 · a deterministically-owned fact is never emitted', () => {
  it('refuses followup.overdue outright, before any row is written', async () => {
    open()
    // The REAL registry lookup — this test exists to prove Condition 13 with the
    // production predicate, not with a stub.
    const d = deps({ isOwnedByDeterministicNotification: realIsOwned })
    const r = await emitInsight({ ...input, expectation: 'followup.overdue' }, { now: NOW, deps: d as never })
    expect(r.outcome).toBe('refused_owned_expectation')
    expect(d.createInsight).not.toHaveBeenCalled()
    expect(d.notifyEvent).not.toHaveBeenCalled()
  })

  it('also refuses an UNDECLARED expectation — fail-closed, never a guess', async () => {
    open()
    const d = deps({ isOwnedByDeterministicNotification: realIsOwned })
    const r = await emitInsight({ ...input, expectation: 'nobody.declared.this' }, { now: NOW, deps: d as never })
    expect(r.outcome).toBe('refused_owned_expectation')
    expect(d.createInsight).not.toHaveBeenCalled()
  })

  it('refuses exactly the OWNED expectations, and permits the unowned one', async () => {
    open()
    const { DETECTORS } = await import('@/lib/ai/integration/detectors/registry')
    const { NOTIFICATION_OWNERSHIP } = await import('@/lib/ai/integration/notificationOwnership')
    const seen: Record<string, string> = {}
    for (const expectation of Object.keys(DETECTORS)) {
      const d = deps({ isOwnedByDeterministicNotification: realIsOwned })
      seen[expectation] = (await emitInsight({ ...input, expectation }, { now: NOW, deps: d as never })).outcome
    }
    // Condition 13, driven by the declaration rather than a hardcoded list: an
    // expectation is refused if and only if a deterministic type owns it.
    for (const [expectation, outcome] of Object.entries(seen)) {
      const owned = NOTIFICATION_OWNERSHIP[expectation as keyof typeof NOTIFICATION_OWNERSHIP] !== null
      expect(outcome === 'refused_owned_expectation').toBe(owned)
    }
    // Phase 4.5's whole point: at least one real expectation now gets through.
    expect(Object.values(seen).some((o) => o !== 'refused_owned_expectation')).toBe(true)
  })
})

// ───────────── C5 · ownership parity ─────────────

describe('C5 · never notify someone who could not have seen the evidence', () => {
  it('delivers when the current owner is the investigation operator', async () => {
    open()
    const d = deps()
    const r = await emitInsight(input, { now: NOW, deps: d as never })
    expect(r.outcome).toBe('delivered')
    expect(d.notifyEvent).toHaveBeenCalledTimes(1)
    expect(d.markDelivered).toHaveBeenCalledWith(1, 88)
  })

  it('does NOT deliver when the lead was reassigned — it resolves instead', async () => {
    open()
    const d = deps({
      buildRecipientContext: vi.fn(async () => ({
        handlerByLead: new Map([[`${AGENCY}:100`, 99]]), // a different rep now owns it
        adminsByAgency: new Map([[AGENCY, [7]]]),
      })),
    })
    const r = await emitInsight(input, { now: NOW, deps: d as never })
    expect(r.outcome).toBe('not_delivered_owner_changed')
    expect(d.notifyEvent).not.toHaveBeenCalled()
    expect(d.closeInsight).toHaveBeenCalledWith(1, 'resolved', 'business_state')
  })

  it('resolves as entity_gone when nobody resolves at all', async () => {
    open()
    const d = deps({
      buildRecipientContext: vi.fn(async () => ({ handlerByLead: new Map(), adminsByAgency: new Map() })),
    })
    const r = await emitInsight(input, { now: NOW, deps: d as never })
    expect(r.outcome).toBe('not_delivered_no_recipient')
    expect(d.closeInsight).toHaveBeenCalledWith(1, 'resolved', 'entity_gone')
  })

  it('an unassigned lead falls back to admins, and delivers when the operator is one', async () => {
    open()
    const d = deps({
      createInsight: vi.fn(async () => ({ created: true as const, row: row({ operatorUserId: 7 }), supersededId: null })),
      buildRecipientContext: vi.fn(async () => ({
        handlerByLead: new Map([[`${AGENCY}:100`, null]]),
        adminsByAgency: new Map([[AGENCY, [7, 9]]]),
      })),
    })
    const r = await emitInsight(input, { now: NOW, deps: d as never })
    expect(r.outcome).toBe('delivered')
  })
})

// ───────────── C10 · the hard cap ─────────────

describe('C10 · three per agency per calendar day, and overflow is not a loss', () => {
  it('the ceiling is exactly 3', () => {
    expect(INSIGHT_DAILY_CAP).toBe(3)
  })

  it('delivers below the cap', async () => {
    open()
    for (const already of [0, 1, 2]) {
      const d = deps({ deliveredCountForDay: vi.fn(async () => already) })
      expect((await emitInsight(input, { now: NOW, deps: d as never })).outcome).toBe('delivered')
    }
  })

  it('holds at and above the cap — OPEN, undelivered, not resolved, not dropped', async () => {
    open()
    for (const already of [3, 4, 99]) {
      const d = deps({ deliveredCountForDay: vi.fn(async () => already) })
      const r = await emitInsight(input, { now: NOW, deps: d as never })
      expect(r.outcome).toBe('held_daily_cap')
      expect(d.createInsight).toHaveBeenCalledTimes(1) // recorded
      expect(d.notifyEvent).not.toHaveBeenCalled() // not delivered
      expect(d.closeInsight).not.toHaveBeenCalled() // not resolved
      expect(d.markDelivered).not.toHaveBeenCalled() // not counted
    }
  })

  it('C8 · a delivery that never enqueued leaves the insight OPEN, never resolved', async () => {
    open()
    for (const reason of ['kill_switch', 'no_product_access', 'duplicate', 'error'] as const) {
      const d = deps({ notifyEvent: vi.fn(async () => ({ enqueued: false as const, reason })) })
      const r = await emitInsight(input, { now: NOW, deps: d as never })
      expect(r.outcome).toBe('delivered')
      // The conclusion is still true; we merely failed to say it. Nothing closes.
      expect(d.closeInsight).not.toHaveBeenCalled()
      expect(d.markDelivered).toHaveBeenCalledWith(1, null)
    }
  })

  it('the cap is checked AFTER ownership, so a stale insight never consumes a slot', async () => {
    open()
    const d = deps({
      deliveredCountForDay: vi.fn(async () => 0),
      buildRecipientContext: vi.fn(async () => ({
        handlerByLead: new Map([[`${AGENCY}:100`, 99]]),
        adminsByAgency: new Map([[AGENCY, [7]]]),
      })),
    })
    await emitInsight(input, { now: NOW, deps: d as never })
    expect(d.deliveredCountForDay).not.toHaveBeenCalled()
  })
})

// ───────────── C9 · supersession is not a second alert ─────────────

describe('C9 · superseding a recently-delivered insight does not re-alert', () => {
  it('suppresses the alert inside the refractory window', async () => {
    open()
    const recent = new Date(NOW.getTime() - 60_000).toISOString()
    vi.doMock('@/config/db', () => ({
      db: Object.assign(() => ({ where: () => ({ first: async () => ({ deliveredAt: recent }) }) }), {}),
    }))
    const d = deps({ createInsight: vi.fn(async () => ({ created: true as const, row: row(), supersededId: 55 })) })
    const r = await emitInsight(input, { now: NOW, deps: d as never })
    expect(r.outcome).toBe('suppressed_supersede_refractory')
    expect(d.notifyEvent).not.toHaveBeenCalled()
    expect(d.closeInsight).not.toHaveBeenCalled() // still open, still true
  })
})

// ───────────── boundaries ─────────────

describe('boundaries', () => {
  const strip = (p: string) =>
    readFileSync(p, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('C4 · no model-supplied urgency, severity, priority or ranking', () => {
    for (const f of ['lib/ai/integration/insightEmit.ts', 'db/ai/insights.ts', 'lib/ai/integration/insightFlags.ts']) {
      const code = strip(f)
      expect(code).not.toMatch(/\b(severity|urgency|importance|score|rank)\b/i)
    }
    // Priority comes from the registry entry and nowhere else.
    expect(getNotificationType('lead.insight')!.basePriority).toBe('medium')
  })

  it('C16 · the deep link targets the lead, never an AI capability URL', () => {
    const def = getNotificationType('lead.insight')!
    const link = def.deepLink({ entityId: 100 } as never)
    expect(link).toBe('/clients/100/summary')
    expect(link).not.toMatch(/insight|ai|agent/i)
  })

  it('the copy is deterministic and never model prose', () => {
    const def = getNotificationType('lead.insight')!
    const title = def.title({ entityId: 100, payload: { leadName: 'דנה' } } as never)
    expect(title).toContain('דנה')
    expect(typeof def.body({ entityId: 100, payload: {} } as never)).toBe('string')
    // No emoji, per CLAUDE.md §12.
    expect(title).not.toMatch(/\p{Extended_Pictographic}/u)
  })

  it('exactly one AI notification type exists', () => {
    // Named for the ליד it concerns, not the machinery — which is also what
    // satisfies the registry's prefix→category invariant without weakening it.
    expect(NOTIFICATION_TYPES.filter((t) => t.includes('insight'))).toEqual(['lead.insight'])
  })

  it('the emitter imports no model, and no notification internals beyond the public door', () => {
    const code = strip('lib/ai/integration/insightEmit.ts')
    expect(code).not.toMatch(/@ai-sdk|from 'ai'|lib\/agent\/run|generateText/)
    expect(code).toMatch(/from '@\/lib\/notifications\/emit'/)
    expect(code).not.toMatch(/notifications\/(worker|processJob|plan|policy|feed|webPush)/)
  })
})
