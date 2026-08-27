/**
 * Wave 1.1A — leadless Contact conversations as SIGNAL SUBJECTS.
 *
 * The product decision this file exists to enforce: a Contact conversation is
 * OBSERVABLE but NOT INVESTIGABLE. It may be detected, queued and measured; it
 * may never reserve AI spend, create an investigation, produce an insight, or
 * reach an autonomous action — because a Contact has no handler, and
 * `resolveAutonomousScope` cannot name a responsible person without inventing
 * one.
 *
 * Two things carry that guarantee and both are asserted here:
 *   · the existing lead-only guard in `checkPreconditions`, which sits BEFORE
 *     the P3 reservation lookup — so the decline costs nothing;
 *   · the deliberately UN-widened CHECKs on the investigation-side tables, so
 *     the database refuses the write even if code one day forgot.
 *
 * Nothing here may weaken Wave 1: a lead-linked conversation must still emit a
 * `lead` subject with an identical observation key.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { detectConversationObjection } from '@/lib/ai/integration/detectors/conversationObjection'
import { detectConversationStalled } from '@/lib/ai/integration/detectors/conversationStalled'
import { observationKeyFor } from '@/lib/ai/integration/observationKey'
import { interpret } from '@/lib/ai/runtime/eventInterpretation'
import { checkPreconditions } from '@/lib/ai/integration/preconditions'
import { businessDayBounds } from '@/lib/today/time'
import {
  agencyObjectionTurnsQuery,
  agencyStalledConversationsQuery,
  subjectForConversationFact,
  type ConversationFacts,
} from '@/db/ai/conversationFacts'
import type { Scope } from '@/db/ai/stateManagement'

const NOW = new Date('2026-08-26T09:00:00.000Z')
const ctx = businessDayBounds(NOW.getTime())
const SCOPE: Scope = { agencyId: 103 }

const CONTACT = { conversationId: 55, leadId: null, triggerSequence: 12 }
const LEADED = { conversationId: 56, leadId: 77, triggerSequence: 12 }

const objection = (o: Record<string, unknown>) => ({ ...o, classifiedAt: NOW.getTime() - 3_600_000 }) as never
const stalled = (o: Record<string, unknown>) =>
  ({ ...o, salesMove: 'BUYING_SIGNAL', engagedAt: NOW.getTime() - 4 * 86_400_000 }) as never

const facts = (o: Partial<ConversationFacts> = {}): ConversationFacts => ({ objections: [], stalled: [], ...o })

// ───────────────────────── 1–4 · Contact vs Lead subjects ────────────────────

describe('Contact conversations become conversation subjects', () => {
  it('1 · a leadless Contact objection uses subjectType=conversation', () => {
    const [s] = detectConversationObjection([], ctx, SCOPE, facts({ objections: [objection(CONTACT)] }))
    expect(s.subject).toEqual({ subjectType: 'conversation', subjectId: '55' })
  })

  it('2 · a leadless Contact stall uses subjectType=conversation', () => {
    const [s] = detectConversationStalled([], ctx, SCOPE, facts({ stalled: [stalled(CONTACT)] }))
    expect(s.subject).toEqual({ subjectType: 'conversation', subjectId: '55' })
  })

  it('3 · a lead-linked objection is UNCHANGED — still subjectType=lead', () => {
    const [s] = detectConversationObjection([], ctx, SCOPE, facts({ objections: [objection(LEADED)] }))
    expect(s.subject).toEqual({ subjectType: 'lead', subjectId: '77' })
  })

  it('4 · a lead-linked stall is UNCHANGED — still subjectType=lead', () => {
    const [s] = detectConversationStalled([], ctx, SCOPE, facts({ stalled: [stalled(LEADED)] }))
    expect(s.subject).toEqual({ subjectType: 'lead', subjectId: '77' })
  })

  it('never uses portfolio as a substitute subject', () => {
    const all = [
      ...detectConversationObjection([], ctx, SCOPE, facts({ objections: [objection(CONTACT)] })),
      ...detectConversationStalled([], ctx, SCOPE, facts({ stalled: [stalled(CONTACT)] })),
    ]
    for (const s of all) expect(s.subject!.subjectType).not.toBe('portfolio')
  })

  it('never fabricates a lead trace ref for a Contact', () => {
    const [s] = detectConversationObjection([], ctx, SCOPE, facts({ objections: [objection(CONTACT)] }))
    expect(s.traceRefs!.some((r) => r.type === 'lead')).toBe(false)
    // 8 · contact conversation identity IS preserved.
    expect(s.traceRefs).toContainEqual({ type: 'conversation', id: '55' })
  })

  it('9 · evidence (the classified turn) is preserved for a Contact', () => {
    const [s] = detectConversationStalled([], ctx, SCOPE, facts({ stalled: [stalled(CONTACT)] }))
    expect(s.traceRefs).toContainEqual({ type: 'turn', id: '12' })
    expect(s.absence?.sinceLastSignalAt).toBe(new Date(NOW.getTime() - 4 * 86_400_000).toISOString())
  })
})

describe('subjectForConversationFact is the single rule', () => {
  it('resolves lead vs conversation from the lead id alone', () => {
    expect(subjectForConversationFact({ leadId: 77, conversationId: 55 })).toEqual({
      subjectType: 'lead',
      subjectId: '77',
    })
    for (const leadId of [null, 0, -1]) {
      expect(subjectForConversationFact({ leadId, conversationId: 55 })).toEqual({
        subjectType: 'conversation',
        subjectId: '55',
      })
    }
  })
})

// ───────────────────────── 5–6 · identity and idempotency ────────────────────

describe('5–6 · deterministic keys and duplicate suppression', () => {
  it('5 · a Contact observation key is deterministic across sweeps', () => {
    const a = detectConversationObjection([], ctx, SCOPE, facts({ objections: [objection(CONTACT)] }))[0]
    const later = businessDayBounds(NOW.getTime() + 7 * 3_600_000)
    const b = detectConversationObjection([], later, SCOPE, facts({ objections: [objection(CONTACT)] }))[0]
    expect(observationKeyFor(a)).toBe(observationKeyFor(b))
  })

  it('6 · repeated detection of one Contact turn is ONE observation', () => {
    const key = (n: number) =>
      observationKeyFor(
        detectConversationObjection([], businessDayBounds(NOW.getTime() + n * 60_000), SCOPE, facts({ objections: [objection(CONTACT)] }))[0],
      )
    expect(new Set([key(0), key(1), key(60)]).size).toBe(1)
  })

  it('a Contact and a Lead subject never collide on the same key', () => {
    const c = detectConversationObjection([], ctx, SCOPE, facts({ objections: [objection(CONTACT)] }))[0]
    const l = detectConversationObjection([], ctx, SCOPE, facts({ objections: [objection(LEADED)] }))[0]
    expect(observationKeyFor(c)).not.toBe(observationKeyFor(l))
    expect(observationKeyFor(c)).toContain('conversation:55')
  })

  it('the ratified ingress accepts a Contact signal', () => {
    const [s] = detectConversationStalled([], ctx, SCOPE, facts({ stalled: [stalled(CONTACT)] }))
    expect(interpret(s).accepted).toBe(true)
  })
})

// ───────────────────────── 7 · tenant isolation ──────────────────────────────

describe('7 · tenant isolation', () => {
  it('a Contact signal carries the caller scope verbatim', () => {
    const other: Scope = { agencyId: 999 }
    const [s] = detectConversationObjection([], ctx, other, facts({ objections: [objection(CONTACT)] }))
    expect(s.scope).toEqual(other)
  })

  it('the readers never resolve a conversation by id alone', () => {
    for (const sql of [
      agencyObjectionTurnsQuery(103, 'pro', 0).toSQL().sql,
      agencyStalledConversationsQuery(103, 'pro', 0).toSQL().sql,
    ]) {
      // The classification row's own agency is the boundary, and it is applied
      // unconditionally — it does not depend on the lead join succeeding.
      expect(sql).toMatch(/"t"\."agencyId"/)
    }
  })

  it('the lead join carries the agency in its ON clause, so it cannot leak across tenants', () => {
    const { sql, bindings } = agencyObjectionTurnsQuery(103, 'pro', 0).toSQL()
    expect(sql).toMatch(/left join "clients"/i)
    expect(sql).toMatch(/"c"\."agencyId"/)
    expect(bindings).toContain(103)
  })

  it('a cross-agency conversation cannot be reached by widening the lead join', () => {
    // Both agency predicates bind the SAME id; there is no path where a row from
    // agency A is joined to a lead from agency B.
    const { bindings } = agencyObjectionTurnsQuery(555, 'pro', 0).toSQL()
    expect(bindings.filter((b) => b === 555).length).toBeGreaterThanOrEqual(2)
  })
})

// ───────────────────── Contacts survive the lead-shaped predicates ───────────

describe('lead-shaped predicates are guarded so a Contact satisfies them vacuously', () => {
  const objSql = agencyObjectionTurnsQuery(103, 'free', 0).toSQL().sql
  const stallSql = agencyStalledConversationsQuery(103, 'free', 0).toSQL().sql

  it('terminal-status exclusion does not sweep out leadless rows', () => {
    expect(objSql).toMatch(/"t"\."leadId" is null or "c"\."status" not in/i)
  })

  it('the free-plan quota gate does not sweep out leadless rows', () => {
    expect(objSql).toMatch(/"t"\."leadId" is null or "c"\."overQuota"/i)
  })

  it('the "nothing scheduled" stall condition does not sweep out leadless rows', () => {
    expect(stallSql).toMatch(/"t"\."leadId" is null or "c"\."nextFollowUpAt" is null/i)
  })

  it('no reader filters on leadId being NOT NULL any more', () => {
    expect(objSql).not.toMatch(/"t"\."leadId" is not null/i)
    expect(stallSql).not.toMatch(/"t"\."leadId" is not null/i)
  })
})

// ───────────────────── 10–15 · admission safety (the whole point) ────────────

describe('10–15 · a Contact signal is declined by the EXISTING admission guard', () => {
  const job = (over: Record<string, unknown> = {}) =>
    ({
      id: 1,
      agencyId: 103,
      observationKey: 'conversation.objection:conversation:55:x',
      expectation: 'conversation.objection',
      subjectType: 'conversation',
      subjectId: '55',
      signal: {},
      attempts: 0,
      maxAttempts: 3,
      ...over,
    }) as never

  /** Every dependency throws: reaching ANY of them is the failure being tested. */
  const forbiddenDeps = {
    deps: {
      isOwnedByDeterministicNotification: () => false,
      readLeadFact: () => {
        throw new Error('P4 reached — a Contact must never read a lead fact')
      },
      lastReservationForSubject: () => {
        throw new Error('P3 reached — a Contact must never touch AI spend')
      },
      resolveAutonomousScope: () => {
        throw new Error('P5 reached — a Contact has no handler to resolve')
      },
    },
  }

  it('10–11 · admission declines a conversation subject', async () => {
    const r = await checkPreconditions(job(), forbiddenDeps as never)
    expect(r.proceed).toBe(false)
    expect(r.proceed === false && r.detail).toContain("subject type 'conversation' is not investigable")
  })

  it('12 · no AI spend reservation is looked up or created', async () => {
    // The dep throws if reached; a clean decline proves P3 was never entered.
    await expect(checkPreconditions(job(), forbiddenDeps as never)).resolves.toMatchObject({ proceed: false })
  })

  it('13–14 · no investigation and no insight can follow a declined precondition', async () => {
    const r = await checkPreconditions(job(), forbiddenDeps as never)
    // `proceed: false` is the only gate: investigation and insight both hang off it.
    expect(r.proceed).toBe(false)
  })

  it('15 · the decline is the pre-existing guard, not a new rejection path', () => {
    const src = readFileSync('lib/ai/integration/preconditions.ts', 'utf8')
    expect(src).toContain("if (job.subjectType !== 'lead')")
    // And it precedes the reservation lookup, so the decline costs nothing.
    expect(src.indexOf("job.subjectType !== 'lead'")).toBeLessThan(src.indexOf('lastReservation({'))
  })

  it('a LEAD subject still proceeds past the guard — Wave 1 unchanged', async () => {
    const r = await checkPreconditions(job({ subjectType: 'lead', subjectId: '77' }), {
      deps: {
        isOwnedByDeterministicNotification: () => false,
        lastReservationForSubject: async () => null,
        readLeadFact: async () => null, // declines later, at P4 — past the guard
        resolveAutonomousScope: async () => ({ ok: false, reason: 'x' }),
      },
    } as never)
    expect(r.proceed === false && r.detail).not.toContain('not investigable')
  })
})

// ───────────────────── the DB boundary is the second lock ────────────────────

describe('the investigation-side tables were deliberately NOT widened', () => {
  const migration = readFileSync('migrations/20260826000005_signal_conversation_subject.cjs', 'utf8')

  it('widens exactly signal_jobs and ai_shadow_coverage', () => {
    expect(migration).toContain("['signal_jobs', 'ai_shadow_coverage']")
  })

  it('does not touch spend, investigations, beliefs or insights', () => {
    for (const table of ['ai_spend_reservations', 'ai_investigations', 'ai_beliefs']) {
      expect(migration).not.toMatch(new RegExp(`ALTER TABLE ${table}`))
    }
    // ai_insights stays lead-only; its CHECK is untouched on disk.
    const insights = readFileSync('migrations/20260825000005_create_ai_insights.cjs', 'utf8')
    expect(insights).toContain(`CHECK ("subjectType" IN ('lead'))`)
  })

  it('is additive and reversible, with no historical rewrite', () => {
    expect(migration).toContain('exports.up')
    expect(migration).toContain('exports.down')
    for (const destructive of ['DROP TABLE', 'DELETE FROM', 'TRUNCATE', 'UPDATE ']) {
      expect(migration).not.toContain(destructive)
    }
  })

  it('looks the constraint name up rather than guessing it', () => {
    // Guessing wrong would leave the old narrow CHECK in place while reporting
    // success — the worst possible outcome for this migration.
    expect(migration).toContain('pg_constraint')
    expect(migration).toContain('pg_get_constraintdef')
  })
})

// ───────────────────── 13 · no customer-facing execution ─────────────────────

describe('a Contact signal can never execute anything', () => {
  it('neither detector nor the reader can send, notify or enqueue', () => {
    const codeOf = (p: string) =>
      readFileSync(p, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ')
    for (const f of [
      'lib/ai/integration/detectors/conversationObjection.ts',
      'lib/ai/integration/detectors/conversationStalled.ts',
    ]) {
      const src = codeOf(f)
      for (const forbidden of ['sendWhatsapp', 'notifyEvent', 'enqueueSignal', 'promoteConversationToLead']) {
        expect(src).not.toContain(forbidden)
      }
    }
  })
})

// ───────────────────── 16–20 · Lead promotion (Part C) ───────────────────────

/**
 * Promotion is NOT re-implemented here. `actions/whatsapp/promoteConversationToLead.ts`
 * already exists, is agency-scoped, and is surfaced in the inbox by
 * `components/inbox/LeadlessConversationActions.tsx`. Its own suite
 * (`__tests__/whatsapp/promoteConversation.test.ts`) already proves agency
 * isolation, idempotency, and that promotion never sends WhatsApp itself.
 *
 * What is asserted here is only what Wave 1.1A adds: that the SIGNAL layer never
 * promotes on its own, and that once a human has promoted, the very same
 * detectors switch to a lead subject with no code change.
 */
describe('16–20 · promotion stays a human decision', () => {
  it('16 · the existing promotion action is reachable from the inbox UI', () => {
    const ui = readFileSync('components/inbox/LeadlessConversationActions.tsx', 'utf8')
    expect(ui).toContain('promoteConversationToLead')
    expect(ui).toContain('listConversationLeadMatches')
  })

  it('16 · promotion is server-side and permission-gated', () => {
    const action = readFileSync('actions/whatsapp/promoteConversationToLead.ts', 'utf8')
    expect(action).toContain("'use server'")
    expect(action).toContain('requireProductAccess')
    // Tenancy comes from an agency-scoped loader, never from the id alone.
    expect(action).toContain('loadOwnedConversation')
  })

  it('17 · NOTHING in the Wave 1.1 signal path can promote a conversation', () => {
    const codeOf = (p: string) =>
      readFileSync(p, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ')
    for (const f of [
      'lib/ai/integration/detectors/conversationObjection.ts',
      'lib/ai/integration/detectors/conversationStalled.ts',
      'db/ai/conversationFacts.ts',
      'lib/ai/integration/signalSweep.ts',
    ]) {
      expect(codeOf(f)).not.toContain('promoteConversationToLead')
      expect(codeOf(f)).not.toContain('upsertLead')
    }
  })

  it('18–19 · once promoted, the SAME detectors emit a lead subject', () => {
    // Before: leadless Contact → conversation subject.
    const before = detectConversationObjection([], ctx, SCOPE, facts({ objections: [objection(CONTACT)] }))[0]
    expect(before.subject!.subjectType).toBe('conversation')

    // After a human promotes, the classification row carries a leadId and the
    // identical detector — unchanged — produces a lead subject.
    const after = detectConversationObjection(
      [],
      ctx,
      SCOPE,
      facts({ objections: [objection({ ...CONTACT, leadId: 77 })] }),
    )[0]
    expect(after.subject).toEqual({ subjectType: 'lead', subjectId: '77' })
    // And it becomes investigable, because the subject is now a lead.
    expect(after.traceRefs).toContainEqual({ type: 'lead', id: '77' })
  })

  it('19 · promotion changes the observation key, so post-promotion work is new', () => {
    const before = detectConversationObjection([], ctx, SCOPE, facts({ objections: [objection(CONTACT)] }))[0]
    const after = detectConversationObjection(
      [],
      ctx,
      SCOPE,
      facts({ objections: [objection({ ...CONTACT, leadId: 77 })] }),
    )[0]
    expect(observationKeyFor(before)).not.toBe(observationKeyFor(after))
  })
})
