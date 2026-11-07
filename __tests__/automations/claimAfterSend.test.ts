import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutomationJob } from '@/db/automations/jobs'
import type { WorkerDefinition } from '@/db/automations/definitions'
import { CONTENT_SCHEMA_VERSION } from '@/db/automations/definitions'
import { runAutomationWorker, type WorkerDeps } from '@/lib/automations/worker'
import { getAction } from '@/lib/automations/catalog/registry'
import { MISSING_MEETING } from '@/lib/automations/appointments'

vi.mock('@/lib/inbox/recordAccountRestriction', () => ({ recordAccountRestriction: vi.fn(async () => undefined) }))
const { whatsappExecutor } = await import('@/lib/automations/executors/whatsapp')

/**
 * Once Meta has ACCEPTED an automation's WhatsApp template (it returned a wamid),
 * no later failure may send it again: not persisting the message, not recording
 * the activity, not confirming the claim, not completing the job — and not a
 * reclaim or a new job for the same automation and lead afterwards.
 *
 * The REAL worker and the REAL WhatsApp executor. Only Meta (the executor's
 * `send`) and the database seams are replaced, by stores that keep the SQL's
 * rules: the once-ever claim is unique per (automation, lead); `release` deletes
 * only a `claimed` row; a `confirmed` claim is permanent; jobs move
 * pending → processing (claim) and back exactly as the queue's queries do.
 */

const NOW = new Date('2026-11-07T12:00:00Z')
const AUTOMATION = 3
const LEAD = 42

const def: WorkerDefinition = {
  id: AUTOMATION,
  agencyId: 7,
  name: 'וואטסאפ לליד חדש',
  recipeKey: null,
  status: 'active',
  trigger: 'lead_created',
  action: null,
  content: { schemaVersion: CONTENT_SCHEMA_VERSION, subject: '', body: '', timing: { kind: 'preset', preset: 'immediate' } },
  createdByUserId: 1,
  conditions: [],
  actions: [{ actionKey: 'whatsapp.send', parameters: { templateId: 5, templateBindings: { '1': 'leadFirstName' } } }],
  connectionId: null,
  sourceIds: [],
} as never

// ── the stores ───────────────────────────────────────────────────────────────
type JobRow = AutomationJob & { status: 'pending' | 'processing' | 'done' | 'skipped' | 'dead'; lastError: string | null }
let jobs: JobRow[] = []
let claims = new Map<string, 'claimed' | 'confirmed'>()
let activity: Array<{ kind: string; providerMessageId?: string | null; skipReason?: string }> = []
let metaSends: string[] = []
const key = (a: number, l: number) => `${a}:${l}`

// Failure switches for the steps after the send.
let fail: { persist?: boolean; activitySent?: boolean; activityAny?: boolean; confirm?: boolean; complete?: boolean; dead?: boolean } = {}
let meta: 'accept' | 'refuse' | 'ambiguous' = 'accept'

function newJob(id: number): JobRow {
  return {
    id, agencyId: 7, automationId: AUTOMATION, leadId: LEAD, trigger: 'lead_created', origin: 'manual',
    eventKey: `lead_created:${id}`, attempts: 0, maxAttempts: 3, createdAt: NOW.toISOString(), status: 'pending', lastError: null,
  }
}
const boom = (step: string) => Object.assign(new Error(`db down at ${step}`), { name: 'DbDown' })

const executor = {
  ...whatsappExecutor,
  defaultDeps: () => ({
    loadTemplate: async () => ({ id: 5, status: 'approved', name: 'welcome_he', language: 'he', bodyText: 'שלום {{1}}', variables: [], bindings: [] }) as never,
    resolveTarget: async () =>
      ({ ok: true, target: { leadId: LEAD, leadName: 'דנה', businessPhoneNumberId: 'pn', accessToken: 't', customerWaId: '972501234567', customerName: 'דנה' } }) as never,
    send: async () => {
      if (meta === 'refuse') return { ok: false as const, error: 'Invalid parameter', code: '100' }
      if (meta === 'ambiguous') {
        metaSends.push('maybe')
        return { ok: false as const, error: 'send-timeout', ambiguous: true as const }
      }
      const wamid = `wamid.${metaSends.length + 1}`
      metaSends.push(wamid)
      return { ok: true as const, wamid }
    },
    persist: async () => {
      if (fail.persist) throw boom('persist')
      return {}
    },
  }),
}

function deps(): WorkerDeps {
  return {
    sendMode: () => 'live',
    reclaim: async () => 0,
    claim: async () => {
      const due = jobs.filter((j) => j.status === 'pending')
      for (const j of due) {
        j.status = 'processing'
        j.attempts++
      }
      return due.map((j) => ({ ...j }))
    },
    getDefinition: async () => def,
    getLeadFacts: async () =>
      ({ exists: true, email: null, phone: '0501234567', currentStatus: 'new', firstName: 'דנה', displayName: 'דנה כהן', handlerId: null }) as never,
    isSuppressed: async () => false,
    isOptedOut: async () => false,
    isRecipientBlocked: async () => false,
    claimState: async (a, l) => claims.get(key(a, l)) ?? 'none',
    claimOnce: async ({ automationId, leadId }) => {
      if (claims.has(key(automationId, leadId))) return false
      claims.set(key(automationId, leadId), 'claimed')
      return true
    },
    confirmClaim: async (a, l) => {
      if (fail.confirm) throw boom('confirm')
      if (claims.has(key(a, l))) claims.set(key(a, l), 'confirmed')
    },
    releaseClaim: async (a, l) => {
      if (claims.get(key(a, l)) === 'claimed') claims.delete(key(a, l))
    },
    hasEffect: async () => activity.some((r) => r.kind === 'sent'),
    countLeadToday: async () => 0,
    countAutoResponsesToday: async () => 0,
    countAgencyToday: async () => 0,
    appendActivity: (async (row: { kind: string; providerMessageId?: string | null; skipReason?: string }) => {
      if (fail.activityAny || (fail.activitySent && row.kind === 'sent')) throw boom('activity')
      activity.push(row)
    }) as never,
    agencyName: async () => 'העסק',
    repName: async () => null,
    meetingFacts: async () => MISSING_MEETING,
    getAction,
    executorFor: (k: string) => (k === 'whatsapp.send' ? (executor as never) : null),
    completeJob: async (id) => {
      if (fail.complete) throw boom('complete')
      setJob(id, 'done')
    },
    skipJob: async (id, reason) => setJob(id, 'skipped', reason),
    failJob: async (id, error) => {
      const j = jobs.find((r) => r.id === id)!
      setJob(id, j.attempts >= j.maxAttempts ? 'dead' : 'pending', error)
    },
    deadJob: async (id, error) => {
      if (fail.dead) throw boom('dead')
      setJob(id, 'dead', error)
    },
    now: () => NOW,
  }
}
function setJob(id: number, status: JobRow['status'], lastError: string | null = null) {
  const j = jobs.find((r) => r.id === id)!
  j.status = status
  j.lastError = lastError
}
const run = () => runAutomationWorker({ deps: deps(), workerId: 'w-test' })
/** What the lease reclaim does to a job a dead worker left `processing`. */
const reclaimAll = () => jobs.filter((j) => j.status === 'processing').forEach((j) => (j.status = 'pending'))
/** Force a terminal job back into the queue — the worst any later bug could do. */
const forceRequeue = (id: number) => setJob(id, 'pending')
const job = (id = 1) => jobs.find((j) => j.id === id)!

beforeEach(() => {
  jobs = [newJob(1)]
  claims = new Map()
  activity = []
  metaSends = []
  fail = {}
  meta = 'accept'
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

/** After a post-send failure: a requeue, a reclaim and a brand-new job for the same lead send nothing. */
async function expectNeverSentAgain() {
  fail = {}
  forceRequeue(1)
  await run()
  reclaimAll()
  await run()
  jobs.push(newJob(2))
  await run()
  expect(metaSends).toHaveLength(1)
  expect(job(2).status).not.toBe('done')
}

describe('a send Meta accepted is never sent again, whatever fails after it', () => {
  it('happy path is unchanged: sent once, claim confirmed, sent activity, job done', async () => {
    await run()
    expect(metaSends).toEqual(['wamid.1'])
    expect(claims.get(key(AUTOMATION, LEAD))).toBe('confirmed')
    expect(activity).toEqual([expect.objectContaining({ kind: 'sent', providerMessageId: 'wamid.1' })])
    expect(job().status).toBe('done')
  })

  it('persisting the message fails: claim confirmed, job dead with the step and wamid, never resent', async () => {
    fail.persist = true
    await run()
    expect(metaSends).toHaveLength(1)
    expect(claims.get(key(AUTOMATION, LEAD))).toBe('confirmed')
    expect(job().status).toBe('dead')
    expect(job().lastError).toBe('post_send_incomplete: persist_message providerMessageId=wamid.1')
    // The sent activity is still recorded: only the conversation row is missing.
    expect(activity).toEqual([expect.objectContaining({ kind: 'sent', providerMessageId: 'wamid.1' })])
    await expectNeverSentAgain()
  })

  it('recording the activity fails: claim confirmed, job dead, never resent', async () => {
    fail.activitySent = true
    await run()
    expect(metaSends).toHaveLength(1)
    expect(claims.get(key(AUTOMATION, LEAD))).toBe('confirmed')
    expect(job()).toMatchObject({ status: 'dead', lastError: 'post_send_incomplete: append_activity providerMessageId=wamid.1' })
    await expectNeverSentAgain()
  })

  it('confirming the claim fails: the claim stays held (never released), job dead, never resent', async () => {
    fail.confirm = true
    await run()
    expect(metaSends).toHaveLength(1)
    expect(claims.get(key(AUTOMATION, LEAD))).toBe('claimed')
    expect(job()).toMatchObject({ status: 'dead', lastError: 'post_send_incomplete: confirm_claim providerMessageId=wamid.1' })
    await expectNeverSentAgain()
    // A held, unconfirmed claim is ADR-011's ambiguous state: the new job dies, it does not send.
    expect(job(2)).toMatchObject({ status: 'dead', lastError: 'ambiguous_after_crash' })
  })

  it('completing the job fails: still never resent', async () => {
    fail.complete = true
    await run()
    expect(metaSends).toHaveLength(1)
    expect(claims.get(key(AUTOMATION, LEAD))).toBe('confirmed')
    expect(job()).toMatchObject({ status: 'dead', lastError: 'post_send_incomplete: complete_job providerMessageId=wamid.1' })
    await expectNeverSentAgain()
  })

  it('every write after the send fails (database down): job left processing, the reclaim does not resend', async () => {
    fail = { persist: true, activityAny: true, confirm: true, complete: true, dead: true }
    await run()
    expect(metaSends).toHaveLength(1)
    expect(claims.get(key(AUTOMATION, LEAD))).toBe('claimed')
    expect(job().status).toBe('processing')

    fail = {}
    reclaimAll()
    await run()
    expect(metaSends).toHaveLength(1)
    expect(job()).toMatchObject({ status: 'dead', lastError: 'ambiguous_after_crash' })
  })
})

describe('everything before the send keeps its existing behaviour', () => {
  it('a definite Meta refusal releases the claim and retries; the retry sends', async () => {
    meta = 'refuse'
    await run()
    expect(metaSends).toHaveLength(0)
    expect(claims.has(key(AUTOMATION, LEAD))).toBe(false)
    expect(job()).toMatchObject({ status: 'pending', lastError: expect.stringContaining('Invalid parameter') })

    meta = 'accept'
    await run()
    expect(metaSends).toEqual(['wamid.1'])
    expect(job().status).toBe('done')
  })

  it('an ambiguous send (PR1) keeps the claim and is terminal, never retried', async () => {
    meta = 'ambiguous'
    await run()
    expect(metaSends).toHaveLength(1)
    expect(claims.get(key(AUTOMATION, LEAD))).toBe('claimed')
    expect(job()).toMatchObject({ status: 'dead', lastError: 'send_outcome_unknown' })
    meta = 'accept'
    await expectNeverSentAgain()
  })

  it('crash recovery is unchanged: an unconfirmed claim from a dead worker is never sent', async () => {
    claims.set(key(AUTOMATION, LEAD), 'claimed')
    await run()
    expect(metaSends).toHaveLength(0)
    expect(job()).toMatchObject({ status: 'dead', lastError: 'ambiguous_after_crash' })
  })

  it('a lead that already has a confirmed send is skipped as already_sent', async () => {
    claims.set(key(AUTOMATION, LEAD), 'confirmed')
    await run()
    expect(metaSends).toHaveLength(0)
    expect(job()).toMatchObject({ status: 'skipped', lastError: 'already_sent' })
  })
})
