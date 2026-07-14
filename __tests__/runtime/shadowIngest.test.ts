/**
 * Integration-1 shadow ingestion — integration tests (real PostgreSQL).
 *
 * Proves the shadow path writes real beliefs into the runtime World Model
 * (M3 ingress → M2 write → M1) when a canary agency is allowlisted, that those
 * beliefs walk back to the conversation, and that with the flag off nothing is
 * written at all. Runs under `test:runtime`.
 */
import { afterAll, afterEach, describe, it, expect } from 'vitest'
import { db } from '@/config/db'
import { readBeliefs, type Scope } from '@/db/ai/stateManagement'
import { shadowIngestQualification } from '@/lib/ai/integration/shadowIngest'

afterAll(async () => {
  await db.destroy()
})

const NOW = new Date('2026-07-14T00:00:00.000Z')
const savedAllow = process.env.SHADOW_INGEST_AGENCY_IDS
const savedKill = process.env.SHADOW_INGEST_KILL
afterEach(() => {
  if (savedAllow === undefined) delete process.env.SHADOW_INGEST_AGENCY_IDS
  else process.env.SHADOW_INGEST_AGENCY_IDS = savedAllow
  if (savedKill === undefined) delete process.env.SHADOW_INGEST_KILL
  else process.env.SHADOW_INGEST_KILL = savedKill
})

describe('Integration-1 shadow ingest — over the live runtime', () => {
  it('writes shadow beliefs for a canary agency, provenance walking back to the conversation', async () => {
    const scope: Scope = { agencyId: 9901 }
    process.env.SHADOW_INGEST_AGENCY_IDS = '9901'
    delete process.env.SHADOW_INGEST_KILL

    const r = await shadowIngestQualification({
      agencyId: scope.agencyId,
      leadId: 'lead-777',
      conversationId: 555,
      extracted: { budget: '50k', urgency: 'high' },
      occurredAt: NOW,
    })
    expect(r.skipped).toBe(false)
    expect(r.ingested).toBe(2)

    const beliefs = await readBeliefs(scope, { subjectType: 'lead', subjectId: 'lead-777' }, { now: NOW })
    expect(beliefs.map((b) => b.key).sort()).toEqual(['qualification.budget', 'qualification.urgency'])
    const budget = beliefs.find((b) => b.key === 'qualification.budget')!
    expect(budget.content).toEqual({ value: '50k' })
    expect(budget.provenance.traceRefs).toContainEqual({ type: 'conversation', id: '555' })
    expect(budget.provenance.inferentialDistance).toBe('medium')
  })

  it('writes nothing when the flag is off (legacy path completely untouched)', async () => {
    const scope: Scope = { agencyId: 9902 }
    delete process.env.SHADOW_INGEST_AGENCY_IDS // off everywhere
    delete process.env.SHADOW_INGEST_KILL

    const r = await shadowIngestQualification({
      agencyId: scope.agencyId,
      leadId: 'lead-off',
      conversationId: 556,
      extracted: { budget: '99k' },
      occurredAt: NOW,
    })
    expect(r.skipped).toBe(true)

    const beliefs = await readBeliefs(scope, { subjectType: 'lead', subjectId: 'lead-off' }, { now: NOW })
    expect(beliefs).toHaveLength(0)
  })

  it('the global kill backstop halts an allowlisted agency', async () => {
    const scope: Scope = { agencyId: 9903 }
    process.env.SHADOW_INGEST_AGENCY_IDS = '9903'
    process.env.SHADOW_INGEST_KILL = '1'

    const r = await shadowIngestQualification({
      agencyId: scope.agencyId,
      leadId: 'lead-kill',
      conversationId: 557,
      extracted: { budget: '1m' },
      occurredAt: NOW,
    })
    expect(r.skipped).toBe(true)
    const beliefs = await readBeliefs(scope, { subjectType: 'lead', subjectId: 'lead-kill' }, { now: NOW })
    expect(beliefs).toHaveLength(0)
  })
})
