/**
 * The autonomous objective must NAME its subject.
 *
 * `objectiveFor` took only the expectation, so the question reaching GPT said "this
 * lead" with no referent. Two production investigations proved the cost:
 * inv_mtb9z7nb_2yua5m (lead 1513) and inv_mtbbdzql_0cd7po (dummy lead 1495) each
 * made exactly ONE tool call — `get_today_state`, the only tool taking no argument —
 * and the second reported it plainly: "there are 36 leads in the queue, so the
 * description alone does not identify a single lead." The Value Bar rejected both on
 * provenance. `signal_jobs.subjectId` held the id the whole time; admission simply
 * never passed it.
 */
import { describe, it, expect, vi } from 'vitest'
import { INVESTIGATION_OBJECTIVE, objectiveFor } from '@/lib/ai/integration/investigationObjective'
import type { ExpectationKind } from '@/lib/ai/integration/detectors/registry'

const KINDS = Object.keys(INVESTIGATION_OBJECTIVE) as ExpectationKind[]
const SUBJECT = { subjectType: 'lead', subjectId: '1495' }

describe('every declared expectation addresses its subject', () => {
  it.each(KINDS)('%s names the subject id', (kind) => {
    const o = objectiveFor(kind, SUBJECT)
    expect(o).toContain('1495')
    expect(o).toContain('Subject: lead 1495.')
    expect(o.startsWith('Subject: lead 1495.')).toBe(true)
  })

  it.each(KINDS)('%s preserves the declared text VERBATIM', (kind) => {
    // The subject is a prefix. The question the system decided to ask is untouched.
    expect(objectiveFor(kind, SUBJECT)).toContain(INVESTIGATION_OBJECTIVE[kind])
    expect(objectiveFor(kind, SUBJECT).endsWith(INVESTIGATION_OBJECTIVE[kind])).toBe(true)
  })

  it('is total over ExpectationKind — a new detector cannot slip through', () => {
    expect(KINDS.length).toBeGreaterThanOrEqual(5)
    for (const k of KINDS) expect(typeof INVESTIGATION_OBJECTIVE[k]).toBe('string')
  })

  it('carries NO customer identity — only the opaque row id', () => {
    const o = objectiveFor('sla.open_loop', SUBJECT)
    for (const pii of ['name', 'phone', '@', '+972', 'status:']) {
      expect(o.toLowerCase()).not.toContain(pii.toLowerCase())
    }
  })
})

describe('backward compatibility and error behaviour', () => {
  it('omitting the subject returns the original string unchanged', () => {
    for (const k of KINDS) expect(objectiveFor(k)).toBe(INVESTIGATION_OBJECTIVE[k])
  })

  it('still throws for an undeclared expectation, with or without a subject', () => {
    expect(() => objectiveFor('nope.not.declared')).toThrow(/no declared objective/)
    expect(() => objectiveFor('nope.not.declared', SUBJECT)).toThrow(/no declared objective/)
  })

  it('a portfolio subject is addressed by its own type', () => {
    expect(objectiveFor('sla.open_loop', { subjectType: 'portfolio', subjectId: '7' })).toContain('Subject: portfolio 7.')
  })
})

/**
 * The tools must be ALLOWED to use the id the objective supplies. Their schemas said
 * "taken from an earlier tool result. Never invented." — which forbade exactly the
 * server-supplied subject this change introduces. The safety rule is preserved:
 * never invented; the permitted sources are now named explicitly.
 */
describe('tool contracts admit the server-supplied subject id', () => {
  const read = (p: string) => require('node:fs').readFileSync(p, 'utf8')

  it.each(['lib/agent/tools/getLead.ts', 'lib/agent/tools/getConversation.ts'])('%s permits the investigation subject', (p) => {
    const src = read(p)
    // The .describe() the MODEL sees — not merely the human-facing description.
    const describeText = src
      .replace(/\s+/g, ' ')
      .match(/leadId: z ?\.number\(\) ?\.int\(\) ?\.positive\(\) ?\.describe\( ?'([^']+)'/)
    expect(describeText, `${p}: could not read the leadId .describe() text`).toBeTruthy()
    expect(describeText![1]).toContain('investigation subject')
    // The boundary that must NOT move.
    expect(src).toContain('Never invented.')
    // Schema and execution semantics unchanged (prettier may wrap the chain).
    expect(src.replace(/\s+/g, ' ')).toMatch(/leadId: z\s?\.number\(\) ?\.int\(\) ?\.positive\(\)/)
  })
})

/**
 * ADMISSION MUST PROPAGATE THE SUBJECT. This is the mutation that matters: dropping
 * `{ subjectType, subjectId }` at the call site restores the exact production defect,
 * and nothing above would notice, because objectiveFor still works perfectly when
 * asked without a subject.
 */
describe('investigationAdmission passes the job subject through to the Agent', () => {
  const NOW = new Date('2026-08-27T09:22:00.000Z')
  const SCOPE = {
    agencyId: 103,
    userId: 332,
    role: 'ADMIN',
    gotPermIds: [],
    plan: 'pro',
    firstName: 'ע',
  } as unknown as import('@/lib/agent/types').AgentScope

  const job = (): import('@/db/ai/signalJobs').SignalJob => ({
    id: 40074,
    agencyId: 103,
    observationKey: 'sla.open_loop:lead:1495:at:2026-08-25T12:00:00.000Z',
    expectation: 'sla.open_loop',
    subjectType: 'lead',
    subjectId: '1495',
    signal: { absence: { expectedBy: '2026-08-25T12:00:00.000Z' } } as never,
    status: 'leased',
    attempts: 1,
    maxAttempts: 3,
    detectedAt: NOW.toISOString(),
    createdAt: NOW.toISOString(),
  })

  async function run() {
    const { admitInvestigation } = await import('@/lib/ai/integration/investigationAdmission')
    const runAgent = vi.fn(async () => ({
      ok: false as const,
      reason: 'no_evidence' as const,
      investigationId: 'inv_x',
      costUsd: 0.01,
      steps: 1,
      evidence: [],
      droppedClaims: 0,
      strippedRefs: 0,
      rejection: 'no-supportable-claim',
    }))
    const recordInvestigation = vi.fn(async () => undefined as never)
    await admitInvestigation(job(), {
      now: NOW,
      deps: {
        checkPreconditions: vi.fn(async () => ({
          proceed: true as const,
          scope: SCOPE,
          state: 'OPEN_LOOP_SLA' as const,
          operatorUserId: 332,
          value: {
            state: 'OPEN_LOOP_SLA',
            ownedByDeterministicNotification: false,
            expectedByMs: Date.parse('2026-08-25T12:00:00.000Z'),
            clock: { nowMs: NOW.getTime(), dayStart: NOW.getTime() - 3.6e6, dayEnd: NOW.getTime() + 3.6e6 },
            vigilance: 'dropped_commitment' as const,
          },
        })),
        reserve: vi.fn(async () => ({ reserved: true as const, row: { id: 7 } as never })),
        settle: vi.fn(async () => true),
        runAgent,
        recordInvestigation,
      } as never,
    })
    const sentCall = runAgent.mock.calls as unknown as [{ question?: string }][]
    const persistedCall = recordInvestigation.mock.calls as unknown as [{ objective?: string }][]
    return {
      sent: sentCall[0]?.[0] ?? {},
      persisted: persistedCall[0]?.[0] ?? {},
    }
  }

  it('the question sent to runAgent names the triggering lead', async () => {
    const { sent } = await run()
    expect(sent.question, 'admission must pass the job subject to objectiveFor').toContain('Subject: lead 1495.')
    expect(sent.question).toContain('1495')
  })

  it('the persisted objective equals the objective actually sent', async () => {
    const { sent, persisted } = await run()
    expect(persisted.objective).toBe(sent.question)
    expect(persisted.objective).toContain('Subject: lead 1495.')
  })
})
