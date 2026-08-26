/**
 * P0-4 — the recovery worker, wired.
 *
 * The policy is unit-tested separately; what matters here is that the worker
 * cannot violate the one invariant that would make it worse than the bug it
 * fixes: IT MUST NEVER CREATE A DUPLICATE LEAD. A queue that recovers a lead
 * twice is a worse outcome than a queue that loses it once, because the
 * duplicate is silent and reaches the customer's pipeline.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  claimed: [] as Record<string, unknown>[],
  page: null as Record<string, unknown> | null,
  existingClient: undefined as unknown,
  graph: { ok: true, status: 200, body: { field_data: [{ name: 'full_name', values: ['דוד כהן'] }] } } as {
    ok: boolean
    status: number
    body: Record<string, unknown>
  },
  createdLeads: [] as Record<string, unknown>[],
  resolved: [] as { id: number; resolution: string }[],
  dead: [] as { id: number; resolution: string }[],
  rescheduled: [] as { id: number; attempts: number }[],
  alerts: [] as string[],
}))

vi.mock('@/config/db', () => {
  const qb = (table: string) => {
    const b: Record<string, unknown> = {}
    b.where = () => b
    b.whereIn = () => b
    b.whereNull = () => b
    b.select = () => b
    b.update = async () => 1
    b.first = async () => (table === 'facebook_pages' ? h.page : h.existingClient)
    return b
  }
  return { db: Object.assign((t: string) => qb(t), { raw: () => ({}) }) }
})

vi.mock('@/db/webhookFailures', () => ({
  claimDueFailures: async () => h.claimed,
  markFailureResolved: async (id: number, resolution: string) => void h.resolved.push({ id, resolution }),
  markFailureDead: async (id: number, resolution: string) => void h.dead.push({ id, resolution }),
  rescheduleFailure: async (id: number, attempts: number) => void h.rescheduled.push({ id, attempts }),
  setFailureAgency: async () => {},
}))

vi.mock('@/lib/facebook/leadNodeFetch', () => ({
  fetchLeadWithTimeout: async () => ({
    ok: h.graph.ok,
    status: h.graph.status,
    json: async () => h.graph.body,
  }),
}))

vi.mock('@/lib/system/createClientFromWebhook', () => ({
  createLeadFromWebhook: async (input: Record<string, unknown>) => {
    h.createdLeads.push(input)
    return { id: 501 }
  },
}))

vi.mock('@/lib/facebook/integrationNotifications', () => ({
  notifyFacebookIngestionFailed: async (_c: unknown, leadId: string) => void h.alerts.push(leadId),
}))

const ROW = {
  id: 1,
  lead_id: 'LEAD_A',
  page_id: 'PAGE_1',
  agency_id: 103,
  error_type: 'graph_api_error',
  attempts: 0,
  max_attempts: 5,
}

beforeEach(() => {
  h.claimed = [{ ...ROW }]
  h.page = { agency_id: 103, user_id: 7, page_access_token: 'tok', health_status: 'healthy' }
  h.existingClient = undefined
  h.graph = { ok: true, status: 200, body: { field_data: [{ name: 'full_name', values: ['דוד כהן'] }] } }
  h.createdLeads = []
  h.resolved = []
  h.dead = []
  h.rescheduled = []
  h.alerts = []
})

describe('runWebhookFailureRetry', () => {
  it('recovers a transient failure and resolves the row', async () => {
    const { runWebhookFailureRetry } = await import('@/lib/facebook/retryWebhookFailures')
    const r = await runWebhookFailureRetry()

    expect(h.createdLeads).toHaveLength(1)
    expect(h.resolved).toEqual([{ id: 1, resolution: 'recovered' }])
    expect(r.recovered).toBe(1)
  })

  it('NEVER creates a second lead when one already exists', async () => {
    // The idempotency case: a redelivery won the race while this row waited.
    h.existingClient = { id: 500 }
    const { runWebhookFailureRetry } = await import('@/lib/facebook/retryWebhookFailures')
    const r = await runWebhookFailureRetry()

    expect(h.createdLeads).toHaveLength(0)
    expect(h.resolved).toEqual([{ id: 1, resolution: 'already_exists' }])
    expect(r.alreadyExisted).toBe(1)
  })

  it('reschedules with backoff instead of retrying in a tight loop', async () => {
    h.graph = { ok: false, status: 500, body: {} }
    const { runWebhookFailureRetry } = await import('@/lib/facebook/retryWebhookFailures')
    const r = await runWebhookFailureRetry()

    expect(h.createdLeads).toHaveLength(0)
    expect(h.rescheduled).toEqual([{ id: 1, attempts: 1 }])
    expect(r.rescheduled).toBe(1)
  })

  it('never spends a Graph call on a connection already known dead', async () => {
    h.page = { agency_id: 103, user_id: 7, page_access_token: 'tok', health_status: 'token_expired' }
    const { runWebhookFailureRetry } = await import('@/lib/facebook/retryWebhookFailures')
    await runWebhookFailureRetry()

    expect(h.dead).toEqual([{ id: 1, resolution: 'needs_reconnect' }])
    expect(h.createdLeads).toHaveLength(0)
    // Connection problems have their own notification; no per-lead alert here.
    expect(h.alerts).toEqual([])
  })

  it('never retries a token_expired failure, whatever the connection says', async () => {
    h.claimed = [{ ...ROW, error_type: 'token_expired' }]
    const { runWebhookFailureRetry } = await import('@/lib/facebook/retryWebhookFailures')
    await runWebhookFailureRetry()

    expect(h.dead).toEqual([{ id: 1, resolution: 'needs_reconnect' }])
    expect(h.createdLeads).toHaveLength(0)
  })

  it('goes terminal and alerts once the budget is exhausted', async () => {
    h.claimed = [{ ...ROW, attempts: 4, max_attempts: 5 }]
    h.graph = { ok: false, status: 500, body: {} }
    const { runWebhookFailureRetry } = await import('@/lib/facebook/retryWebhookFailures')
    const r = await runWebhookFailureRetry()

    expect(h.dead).toEqual([{ id: 1, resolution: 'max_attempts' }])
    expect(h.alerts).toEqual(['LEAD_A'])
    expect(r.dead).toBe(1)
  })

  it('drops a row whose Page is no longer connected, without retrying forever', async () => {
    h.page = null
    const { runWebhookFailureRetry } = await import('@/lib/facebook/retryWebhookFailures')
    await runWebhookFailureRetry()

    expect(h.dead).toEqual([{ id: 1, resolution: 'no_connection' }])
  })

  it('one poisoned row never stops the pass', async () => {
    h.claimed = [
      { ...ROW, id: 1 },
      { ...ROW, id: 2, lead_id: 'LEAD_B' },
    ]
    const { runWebhookFailureRetry } = await import('@/lib/facebook/retryWebhookFailures')
    const r = await runWebhookFailureRetry()

    expect(r.claimed).toBe(2)
    expect(h.resolved.map((x) => x.id).sort()).toEqual([1, 2])
  })
})
