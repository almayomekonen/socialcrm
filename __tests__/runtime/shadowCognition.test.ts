/**
 * Integration-2 shadow cognition — integration tests (real PostgreSQL).
 *
 * Proves the full read spine runs end-to-end over the live substrate
 * (M3 → M4 → M5 → M6) and persists a shadow decision to the isolated sink:
 * a grounded belief yields a Recommend, an empty model yields Stay Silent, the
 * write is idempotent per turn, and with the flag off nothing is written.
 * Runs under `test:runtime`.
 */
import { afterAll, afterEach, describe, it, expect } from 'vitest'
import { db } from '@/config/db'
import { writeBelief, type Scope } from '@/db/ai/stateManagement'
import { readShadowDecisions } from '@/db/ai/shadowDecisions'
import { shadowReasonAndDecide } from '@/lib/ai/integration/shadowCognition'

afterAll(async () => {
  await db.destroy()
})

const NOW = new Date('2026-07-14T00:00:00.000Z')
const conversationTrace = { traceRefs: [{ type: 'conversation', id: '555' }], inferentialDistance: 'medium' as const }

const savedAllow = process.env.SHADOW_COGNITION_AGENCY_IDS
const savedKill = process.env.SHADOW_COGNITION_KILL
afterEach(() => {
  if (savedAllow === undefined) delete process.env.SHADOW_COGNITION_AGENCY_IDS
  else process.env.SHADOW_COGNITION_AGENCY_IDS = savedAllow
  if (savedKill === undefined) delete process.env.SHADOW_COGNITION_KILL
  else process.env.SHADOW_COGNITION_KILL = savedKill
})

async function seedQualificationBelief(scope: Scope, subjectId: string): Promise<void> {
  await writeBelief({
    agencyId: scope.agencyId,
    subjectType: 'lead',
    subjectId,
    key: 'qualification.budget',
    content: { value: '50k' },
    confidence: 0.85,
    groundedness: 0.6,
    evidenceFor: [{ type: 'conversation', id: '555' }],
    provenance: conversationTrace,
    freshnessAt: NOW,
  })
}

describe('Integration-2 shadow cognition — over the live read spine', () => {
  it('reasons a grounded belief into a persisted Recommend shadow decision', async () => {
    const scope: Scope = { agencyId: 9911 }
    process.env.SHADOW_COGNITION_AGENCY_IDS = '9911'
    delete process.env.SHADOW_COGNITION_KILL
    await seedQualificationBelief(scope, 'lead-1')

    const r = await shadowReasonAndDecide(
      { agencyId: scope.agencyId, leadId: 'lead-1', conversationId: 555, turnCount: 1, occurredAt: NOW },
      {},
    )
    expect(r.skipped).toBe(false)
    expect(r.ran).toBe(true)
    expect(r.outcome).toBe('recommend')
    expect(r.persisted).toBe(true)

    const rows = await readShadowDecisions(scope.agencyId, { subjectType: 'lead', subjectId: 'lead-1' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ outcome: 'recommend', emitted: true, conversationId: 555, turnCount: 1 })
    expect(rows[0].decision).not.toBeNull()
  })

  it('reasons an empty model into a persisted Stay Silent shadow decision', async () => {
    const scope: Scope = { agencyId: 9912 }
    process.env.SHADOW_COGNITION_AGENCY_IDS = '9912'
    delete process.env.SHADOW_COGNITION_KILL

    const r = await shadowReasonAndDecide(
      { agencyId: scope.agencyId, leadId: 'ghost', conversationId: 556, turnCount: 1, occurredAt: NOW },
      {},
    )
    expect(r.outcome).toBe('stay_silent')
    const rows = await readShadowDecisions(scope.agencyId, { subjectType: 'lead', subjectId: 'ghost' })
    expect(rows).toHaveLength(1)
    expect(rows[0].outcome).toBe('stay_silent')
  })

  it('is idempotent per turn: re-running the same turn upserts (one row)', async () => {
    const scope: Scope = { agencyId: 9913 }
    process.env.SHADOW_COGNITION_AGENCY_IDS = '9913'
    delete process.env.SHADOW_COGNITION_KILL
    await seedQualificationBelief(scope, 'lead-2')

    const call = () =>
      shadowReasonAndDecide({ agencyId: scope.agencyId, leadId: 'lead-2', conversationId: 777, turnCount: 4, occurredAt: NOW }, {})
    await call()
    await call()

    const rows = await readShadowDecisions(scope.agencyId, { subjectType: 'lead', subjectId: 'lead-2' })
    expect(rows).toHaveLength(1) // upserted, not duplicated
  })

  it('writes nothing when the flag is off', async () => {
    const scope: Scope = { agencyId: 9914 }
    delete process.env.SHADOW_COGNITION_AGENCY_IDS
    delete process.env.SHADOW_COGNITION_KILL
    await seedQualificationBelief(scope, 'lead-off')

    const r = await shadowReasonAndDecide(
      { agencyId: scope.agencyId, leadId: 'lead-off', conversationId: 558, turnCount: 1, occurredAt: NOW },
      {},
    )
    expect(r.skipped).toBe(true)
    const rows = await readShadowDecisions(scope.agencyId, { subjectType: 'lead', subjectId: 'lead-off' })
    expect(rows).toHaveLength(0)
  })
})
