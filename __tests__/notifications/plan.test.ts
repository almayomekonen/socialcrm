import { describe, expect, it } from 'vitest'
import { leadKey, resolveRecipients, type RecipientContext } from '@/db/notifications/recipients'
import { leadIdForJob, planNotification, rebuildCopyForGroupCount, type PlanInput } from '@/lib/notifications/plan'
import { IN_APP_ONLY_CAPABILITIES } from '@/lib/notifications/policy'
import type { EventContext, NotificationType, Presence } from '@/lib/notifications/types'

/**
 * The engine's decisions — spec §6, §22.1. Entirely fixture-driven: no database,
 * which is the only way anything in this repo can be tested today (spec §22.4).
 */

const AGENCY = 7
const HANDLER = 55
const ADMIN_A = 1
const ADMIN_B = 2
const LEAD = 42

function context(over?: { handler?: number | null; leadPresent?: boolean; admins?: number[] }): RecipientContext {
  const handlerByLead = new Map<string, number | null>()
  if (over?.leadPresent !== false) {
    // `handler: null` means UNASSIGNED and must survive as null — the distinction
    // between "no handler" and "not present in the batch" is the thing under test.
    const handler = over && 'handler' in over ? over.handler! : HANDLER
    handlerByLead.set(leadKey(AGENCY, LEAD), handler ?? null)
  }
  return { handlerByLead, adminsByAgency: new Map([[AGENCY, over?.admins ?? [ADMIN_A, ADMIN_B]]]) }
}

function job(over: Partial<PlanInput['job']> = {}): PlanInput['job'] {
  return {
    agencyId: AGENCY,
    type: 'lead.created',
    actorUserId: null,
    entityType: 'lead',
    entityId: LEAD,
    payload: { leadName: 'דניאל כהן' },
    createdAt: '2026-08-11T09:00:00.000Z',
    ...over,
  }
}

const plan = (j: Partial<PlanInput['job']> = {}, ctx = context(), presence: Presence = 'offline') =>
  planNotification({
    job: job(j),
    context: ctx,
    presence: () => presence,
    capabilities: IN_APP_ONLY_CAPABILITIES,
  })

describe('recipient rule: handler_or_admin', () => {
  it('routes to the assigned נציג — not to the owner, not to every admin', () => {
    const result = resolveRecipients({ rule: 'handler_or_admin', agencyId: AGENCY, leadId: LEAD, context: context() })
    expect(result).toEqual([HANDLER])
  })

  it('falls back to all admins ONLY when the lead is genuinely unassigned', () => {
    const result = resolveRecipients({
      rule: 'handler_or_admin',
      agencyId: AGENCY,
      leadId: LEAD,
      context: context({ handler: null }),
    })
    expect(result).toEqual([ADMIN_A, ADMIN_B])
  })

  it('notifies nobody when the lead is absent — a lead nobody can open is not news', () => {
    const result = resolveRecipients({
      rule: 'handler_or_admin',
      agencyId: AGENCY,
      leadId: LEAD,
      context: context({ leadPresent: false }),
    })
    expect(result).toEqual([])
  })

  it('never crosses tenants: a lead id from another agency resolves to nobody', () => {
    const result = resolveRecipients({ rule: 'handler_or_admin', agencyId: 999, leadId: LEAD, context: context() })
    expect(result).toEqual([])
  })
})

describe('recipient rule: admin_only', () => {
  it('reaches every admin, and needs no lead', () => {
    const result = resolveRecipients({ rule: 'admin_only', agencyId: AGENCY, leadId: null, context: context() })
    expect(result).toEqual([ADMIN_A, ADMIN_B])
  })

  it('deduplicates a user listed twice', () => {
    const ctx = context({ admins: [ADMIN_A, ADMIN_A, ADMIN_B] })
    expect(resolveRecipients({ rule: 'admin_only', agencyId: AGENCY, leadId: null, context: ctx })).toEqual([
      ADMIN_A,
      ADMIN_B,
    ])
  })

  it('an agency with no admins notifies nobody rather than falling back to a rep', () => {
    const ctx = context({ admins: [] })
    expect(resolveRecipients({ rule: 'admin_only', agencyId: AGENCY, leadId: null, context: ctx })).toEqual([])
  })
})

describe('the actor is never notified about their own action (§6.3)', () => {
  it('drops the actor when they are the only recipient', () => {
    const result = plan({ actorUserId: HANDLER })
    expect(result).toEqual({ skip: 'actor_only' })
  })

  it('drops ONLY the actor — a co-recipient still hears about it', () => {
    // An admin creates a lead while unassigned: the other admin is still told.
    const result = plan({ actorUserId: ADMIN_A }, context({ handler: null }))
    expect('plan' in result && result.plan.recipients.map((r) => r.userId)).toEqual([ADMIN_B])
  })

  it('a system event (no actor) drops nobody', () => {
    const result = plan({ actorUserId: null })
    expect('plan' in result && result.plan.recipients.map((r) => r.userId)).toEqual([HANDLER])
  })

  it('an actor who is not a recipient changes nothing', () => {
    const result = plan({ actorUserId: 12345 })
    expect('plan' in result && result.plan.recipients.map((r) => r.userId)).toEqual([HANDLER])
  })
})

describe('plan gating', () => {
  it('an unknown type is skipped, never guessed', () => {
    expect(plan({ type: 'lead.exploded' as NotificationType })).toEqual({ skip: 'unknown_type' })
  })

  it('a disabled type is re-checked at execution, not just at enqueue', () => {
    // A job enqueued before a type was disabled must not deliver afterwards.
    expect(plan({ type: 'sla.breached' })).toEqual({ skip: 'type_disabled' })
  })

  it('no recipients is a recorded skip, not a failure', () => {
    expect(plan({}, context({ leadPresent: false }))).toEqual({ skip: 'no_recipients' })
  })

  it('every channel filtered out yields silence rather than an empty row', () => {
    const result = planNotification({
      job: job(),
      context: context(),
      presence: () => 'offline',
      capabilities: { in_app: false, toast: false, web_push: false, email: false },
    })
    expect(result).toEqual({ skip: 'no_channels' })
  })
})

describe('the plan carries what the row needs', () => {
  it('copies category, priority, collapse key and deep link off the registry', () => {
    const result = plan()
    expect('plan' in result && result.plan).toMatchObject({
      type: 'lead.created',
      category: 'leads',
      priority: 'medium',
      collapseKey: `lead:${LEAD}:arrival`,
      entityType: 'lead',
      entityId: LEAD,
      deepLink: `/clients/${LEAD}/summary`,
    })
  })

  it('renders the name the emission site carried, with no extra lookup', () => {
    const result = plan()
    expect('plan' in result && result.plan.recipients[0].title).toBe('ליד חדש — דניאל כהן')
  })

  it('P1 selects in-app only, for every enabled type and every presence state', () => {
    const types: NotificationType[] = [
      'lead.created',
      'lead.hot',
      'lead.assigned',
      'lead.status_changed',
      'lead.activity',
      'message.unanswered',
      'comment.received',
      'followup.due',
      'followup.overdue',
      'integration.disconnected',
      'integration.error',
      'integration.ingestion_failed',
    ]
    for (const type of types) {
      for (const presence of ['online', 'idle', 'offline'] as Presence[]) {
        const result = plan({ type, payload: { leadName: 'א', provider: 'facebook', leadId: LEAD } }, context(), presence)
        if (!('plan' in result)) throw new Error(`${type} produced no plan`)
        for (const recipient of result.plan.recipients) {
          expect(recipient.channels, `${type}/${presence} escaped in-app in P1`).toEqual(['in_app'])
        }
      }
    }
  })
})

describe('leadIdForJob', () => {
  it('uses the entity itself for a lead event', () => {
    expect(leadIdForJob({ entityType: 'lead', entityId: LEAD, payload: {} })).toBe(LEAD)
  })

  it("uses the payload's lead for a conversation event — no query to find it", () => {
    expect(leadIdForJob({ entityType: 'conversation', entityId: 900, payload: { leadId: LEAD } })).toBe(LEAD)
  })

  it('is null when a conversation event carries no lead', () => {
    expect(leadIdForJob({ entityType: 'conversation', entityId: 900, payload: {} })).toBeNull()
  })
})

describe('copy rebuilt against the count the database landed on', () => {
  const ctx: EventContext = {
    type: 'message.inbound_multiple',
    agencyId: AGENCY,
    entityType: 'conversation',
    entityId: 900,
    actorUserId: null,
    occurredAt: new Date('2026-08-11T09:00:00Z'),
    payload: { leadName: 'דניאל כהן' },
    groupCount: 1,
  }

  it('reflects the new count for count-dependent copy', () => {
    expect(rebuildCopyForGroupCount('message.inbound_multiple', ctx, 5)?.title).toContain('5')
  })

  it('is unchanged for count-independent copy, so no extra write happens', () => {
    const leadCtx: EventContext = { ...ctx, type: 'lead.created', entityType: 'lead', entityId: LEAD }
    const first = rebuildCopyForGroupCount('lead.created', leadCtx, 1)
    const later = rebuildCopyForGroupCount('lead.created', leadCtx, 9)
    expect(later).toEqual(first)
  })

  it('returns null for an unknown type', () => {
    expect(rebuildCopyForGroupCount('nope' as NotificationType, ctx, 2)).toBeNull()
  })
})
