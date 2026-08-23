// The platform-operator cancellation notification, as a contract.
//
// Cancelling in SocialCRM sets `cancelAtPeriodEnd` on our own row and contacts
// no payment provider: Grow documents no cancellation operation for a hosted
// Payment-Link mandate, and this system holds no Grow API credentials. The
// standing order therefore has to be stopped by hand, by whoever RUNS
// SocialCRM — not by the customer, and not by their agency's admins, for whom
// it is neither actionable nor their business.
//
// These tests pin the three things that make that safe: the notification reaches
// the platform operator ALONE, it never claims Grow was cancelled, and it is
// raised exactly once per real cancellation.
//
// No DB: runs in the no-DB suite. The engine's decision layer is pure by design
// (plan.ts / recipients.ts take a pre-loaded context), so recipient behaviour is
// provable from fixtures. The call-site contract — transaction, actor, gating,
// logging — is asserted against the source, which is how this repo already pins
// invariants a type system cannot express.

import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { resolveRecipients, type RecipientContext } from '@/db/notifications/recipients'
import { eventKeyForEvent } from '@/lib/notifications/eventKey'
import { subscriptionCancelKey } from '@/lib/notifications/collapseKeys'
import { subscriptionCancellationTitle, subscriptionCancellationBody } from '@/lib/notifications/copy'
import { getNotificationType } from '@/lib/notifications/registry'
import type { EventContext, NotificationEvent } from '@/lib/notifications/types'

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

/**
 * Source with comments removed. These files document the constructs they refuse
 * to use ("`Date.now()` is forbidden here"), so asserting against raw source
 * would forbid explaining the rule. Only executable code counts.
 */
const readCode = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const OWNER_AGENCY = 103
const OWNER_USER = 332
const CANCELLING_AGENCY = 69
const CANCELLED_AT = 1_787_000_000_000

/** An agency admin of the CANCELLING agency, plus one of the owner's own agency. */
const context: RecipientContext = {
  handlerByLead: new Map(),
  adminsByAgency: new Map([
    [CANCELLING_AGENCY, [901, 902]],
    [OWNER_AGENCY, [OWNER_USER, 903]],
  ]),
  platformOperatorIds: [OWNER_USER],
}

const event = (over: Partial<NotificationEvent> = {}): NotificationEvent => ({
  type: 'subscription.cancellation_requested',
  agencyId: OWNER_AGENCY,
  entityType: 'subscription',
  entityId: CANCELLING_AGENCY,
  actorUserId: null,
  occurredAt: new Date(CANCELLED_AT),
  payload: { cancellingAgencyId: CANCELLING_AGENCY, cancellingAgencyName: 'עסק לדוגמה', cancelledAt: CANCELLED_AT },
  ...over,
})

const ctx = (over: Partial<EventContext> = {}): EventContext => ({
  type: 'subscription.cancellation_requested',
  agencyId: OWNER_AGENCY,
  entityType: 'subscription',
  entityId: CANCELLING_AGENCY,
  actorUserId: null,
  occurredAt: new Date(CANCELLED_AT),
  payload: { cancellingAgencyId: CANCELLING_AGENCY, cancellingAgencyName: 'עסק לדוגמה', cancelledAt: CANCELLED_AT },
  groupCount: 1,
  ...over,
})

describe('the recipient is the platform operator, and nobody else', () => {
  const rule = 'platform_operator' as const

  it('resolves to the platform operator', () => {
    expect(resolveRecipients({ rule, agencyId: OWNER_AGENCY, leadId: null, context })).toEqual([OWNER_USER])
  })

  it('never reaches an admin of the CANCELLING agency', () => {
    const got = resolveRecipients({ rule, agencyId: CANCELLING_AGENCY, leadId: null, context })
    expect(got).toEqual([OWNER_USER])
    expect(got).not.toContain(901)
    expect(got).not.toContain(902)
  })

  it('never reaches another admin of the operator OWN agency', () => {
    // 903 is an ADMIN of agency 103. `admin_only` would include them; this must not.
    expect(resolveRecipients({ rule, agencyId: OWNER_AGENCY, leadId: null, context })).not.toContain(903)
    expect(resolveRecipients({ rule: 'admin_only', agencyId: OWNER_AGENCY, leadId: null, context })).toContain(903)
  })

  it('FAILS CLOSED when no platform owner resolves', () => {
    const empty: RecipientContext = { ...context, platformOperatorIds: [] }
    expect(resolveRecipients({ rule, agencyId: OWNER_AGENCY, leadId: null, context: empty })).toEqual([])
  })

  it('FAILS CLOSED when the context predates platform types entirely', () => {
    const legacy: RecipientContext = { handlerByLead: new Map(), adminsByAgency: context.adminsByAgency }
    // Absent means nobody — never a fallback to the agency's admins.
    expect(resolveRecipients({ rule, agencyId: OWNER_AGENCY, leadId: null, context: legacy })).toEqual([])
  })

  it('resolves identically whichever agency the job carries — it is not tenant-derived', () => {
    const a = resolveRecipients({ rule, agencyId: OWNER_AGENCY, leadId: null, context })
    const b = resolveRecipients({ rule, agencyId: 4242, leadId: null, context })
    expect(a).toEqual(b)
  })
})

describe('identity: raised once per real cancellation', () => {
  it('is deterministic — a retry of the same transition collapses', () => {
    expect(eventKeyForEvent(event())).toBe(eventKeyForEvent(event()))
  })

  it('carries the transition moment, so a later cancellation is news', () => {
    const later = event({ payload: { cancellingAgencyId: CANCELLING_AGENCY, cancelledAt: CANCELLED_AT + 1000 } })
    expect(eventKeyForEvent(later)).not.toBe(eventKeyForEvent(event()))
  })

  it('separates two agencies cancelling at the very same instant', () => {
    const other = event({ entityId: 33, payload: { cancellingAgencyId: 33, cancelledAt: CANCELLED_AT } })
    expect(eventKeyForEvent(other)).not.toBe(eventKeyForEvent(event()))
  })

  it('refuses to invent a moment when the payload carries none', () => {
    expect(() => eventKeyForEvent(event({ payload: { cancellingAgencyId: CANCELLING_AGENCY } }))).toThrow(
      /requires payload.cancelledAt/,
    )
  })

  it('never seeds identity from the clock', () => {
    expect(readCode('lib/notifications/eventKey.ts')).not.toContain('Date.now()')
  })
})

describe('collapse: one open action per cancelling agency', () => {
  it('keys on the cancelling agency, not the owner tenant', () => {
    expect(subscriptionCancelKey(ctx())).toBe(`subscription-cancel:${CANCELLING_AGENCY}`)
  })

  it('two different agencies stay two separate open actions', () => {
    expect(subscriptionCancelKey(ctx({ entityId: 33 }))).not.toBe(subscriptionCancelKey(ctx()))
  })

  it('the same agency cancelling twice collapses into one open action', () => {
    const again = ctx({ payload: { cancellingAgencyId: CANCELLING_AGENCY, cancelledAt: CANCELLED_AT + 5000 } })
    expect(subscriptionCancelKey(again)).toBe(subscriptionCancelKey(ctx()))
  })
})

describe('the copy instructs, and never claims Grow was cancelled', () => {
  it('uses the approved title', () => {
    expect(subscriptionCancellationTitle()).toBe('ביטול מנוי דורש טיפול')
  })

  it('names the agency and asks for the Grow standing order to be cancelled', () => {
    expect(subscriptionCancellationBody(ctx())).toBe(
      'עסק לדוגמה ביטל את מנוי SocialCRM. יש לבטל את הוראת הקבע שלו ב-Grow.',
    )
  })

  it('degrades to name-free copy rather than inventing a name', () => {
    const anon = ctx({ payload: { cancellingAgencyId: CANCELLING_AGENCY, cancelledAt: CANCELLED_AT } })
    const body = subscriptionCancellationBody(anon)
    expect(body).toContain('יש לבטל את הוראת הקבע')
    expect(body).not.toContain('undefined')
    expect(body).not.toContain('null')
  })

  it('states a task, never a completed provider outcome', () => {
    const body = subscriptionCancellationBody(ctx())
    for (const claim of ['בוטלה הוראת הקבע', 'הוראת הקבע בוטלה', 'בוטל ב-Grow', 'הופסק החיוב']) {
      expect(body).not.toContain(claim)
    }
    expect(body).toContain('יש לבטל')
  })

  it('carries no emoji', () => {
    const both = subscriptionCancellationTitle() + subscriptionCancellationBody(ctx())
    expect(both).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})

describe('registry wiring', () => {
  const def = getNotificationType('subscription.cancellation_requested')

  it('is registered and enabled', () => {
    expect(def).toBeTruthy()
    expect(def?.enabled).toBe(true)
  })

  it('targets the platform operator at high priority', () => {
    expect(def?.recipients).toBe('platform_operator')
    expect(def?.basePriority).toBe('high')
  })

  it('reuses an existing category, so no migration is implied', () => {
    // notifications.category carries a DB CHECK over exactly five values.
    expect(['leads', 'messages', 'followups', 'sla', 'integrations']).toContain(def?.category)
    expect(def?.category).toBe('integrations')
  })

  it('deep-links to the platform-owner surface', () => {
    expect(def?.deepLink(ctx())).toBe('/admin')
  })

  it('points the entity at the cancelling agency, never the owner tenant', () => {
    expect(def?.entity(ctx())).toEqual({ type: 'subscription', id: CANCELLING_AGENCY })
  })

  it('does not declare a channel the worker cannot deliver', () => {
    // email is capability-false in buildWorkerCapabilities and has no dispatcher.
    const declared = new Set(Object.values(def!.channels).flat())
    expect(declared.has('email')).toBe(false)
  })
})

describe('the call site emits exactly once, transactionally, and loudly', () => {
  const action = read('actions/subscription.ts')

  it('gates on a genuine false → true transition', () => {
    expect(action).toContain("where({ agencyId: user.agencyId, cancelAtPeriodEnd: false })")
    expect(action).toContain('cancelAtPeriodEnd: true')
  })

  it('uses the PERSISTED transition moment as the event identity', () => {
    expect(action).toContain(".returning('updatedAt')")
    expect(action).toContain('cancelledAt: args.cancelledAt.getTime()')
  })

  it('enqueues inside the cancellation transaction', () => {
    expect(action).toContain('db.transaction')
    expect(action).toMatch(/notifyEvent\([\s\S]*\{ trx \}/)
  })

  it('emits as a system event so the operator is never filtered out as the actor', () => {
    expect(action).toContain('actorUserId: null')
  })

  it('stamps the event with the platform owner agency, not the cancelling one', () => {
    expect(action).toContain('agencyId: owner.agencyId')
    expect(action).toContain('entityId: args.cancellingAgencyId')
  })

  it('fails closed when no platform owner resolves', () => {
    expect(action).toContain('no platform owner resolved')
    expect(action).toMatch(/if \(!owner\?\.agencyId\) \{/)
  })

  it('logs every refusal under a searchable prefix', () => {
    expect(action).toContain("const LOG = '[SubscriptionCancellationNotification]'")
    expect(action).toContain('result.enqueued === false')
    expect(action).toContain('not enqueued')
  })

  it('a notification problem can never fail the cancellation', () => {
    expect(action).toContain('swallowed — cancellation still stands')
  })

  it('leaves resumeRenewal untouched', () => {
    expect(action).toContain('export async function resumeRenewal(): Promise<CancelResumeResult> {\n  return setCancelFlag(false)\n}')
  })

  it('changes no entitlement, expiresAt or Grow behaviour', () => {
    expect(action).not.toContain('expiresAt')
    expect(action).not.toContain('performAgencyUpgrade')
    expect(action).not.toMatch(/fetch\(|axios|https?:\/\//)
  })
})

describe('the platform-operator lookup reuses the existing owner allowlist', () => {
  const recipients = read('db/notifications/recipients.ts')

  it('resolves identity from lib/auth/platformOwner, not a second definition', () => {
    expect(recipients).toContain("from '@/lib/auth/platformOwner'")
    expect(recipients).toContain('platformOwnerEmails()')
  })

  it('excludes suspended users, like every other recipient lookup', () => {
    expect(recipients).toMatch(/loadPlatformOperatorsQuery[\s\S]*suspended', false/)
  })

  it('is only loaded when a claimed job actually needs it', () => {
    const worker = read('lib/notifications/worker.ts')
    expect(worker).toContain("recipients === 'platform_operator'")
    expect(worker).toContain('needPlatformOperators')
  })
})
