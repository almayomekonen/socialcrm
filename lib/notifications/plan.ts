import { resolveRecipients, type RecipientContext } from '@/db/notifications/recipients'
import { resolveChannels, type ChannelPreferences } from './policy'
import { getNotificationType } from './registry'
import type {
  Capabilities,
  Channel,
  EntityType,
  EventContext,
  NotificationCategory,
  NotificationPayload,
  NotificationType,
  Presence,
  Priority,
} from './types'

/**
 * THE ENGINE'S DECISION LAYER — pure. Spec §6, §15.1, §19.
 *
 * Everything the notification engine actually *decides* lives here: who gets it,
 * on which channels, and what it says. No database handle, no clock read, no
 * network. That is why the intelligence can be tested exhaustively without a
 * database (spec §22.1) — which matters more than usual in this repo, where the
 * DB-backed harness cannot construct a schema at all (spec §22.4).
 *
 * processJob.ts executes a plan. It makes no decisions of its own.
 */

export type SkipReason = 'unknown_type' | 'type_disabled' | 'no_recipients' | 'actor_only' | 'no_channels'

export type RecipientPlan = {
  userId: number
  channels: Channel[]
  title: string
  body: string | null
  context: EventContext
}

export type NotificationPlan = {
  type: NotificationType
  category: NotificationCategory
  priority: Priority
  collapseKey: string
  entityType: EntityType
  entityId: number
  deepLink: string
  metadata: NotificationPayload
  recipients: RecipientPlan[]
}

export type PlanInput = {
  job: {
    agencyId: number
    type: NotificationType
    actorUserId: number | null
    entityType: EntityType
    entityId: number
    payload: NotificationPayload
    createdAt: string
  }
  context: RecipientContext
  presence: (userId: number) => Presence
  capabilities: Capabilities
  preferences?: (userId: number, category: NotificationCategory) => ChannelPreferences | undefined
}

/**
 * The lead a job is about.
 *
 * For a lead-entity event that is the entity itself. For a conversation-entity
 * event it is the lead the conversation belongs to, which the emission site
 * carries in the payload — resolving it here would mean a query per job.
 */
export function leadIdForJob(job: Pick<PlanInput['job'], 'entityType' | 'entityId' | 'payload'>): number | null {
  if (job.entityType === 'lead') return job.entityId
  return job.payload.leadId ?? null
}

export function planNotification(input: PlanInput): { plan: NotificationPlan } | { skip: SkipReason } {
  const { job, context, presence, capabilities, preferences } = input

  const def = getNotificationType(job.type)
  if (!def) return { skip: 'unknown_type' }
  // Checked again here even though notifyEvent already checked: a job may have
  // been enqueued before a type was disabled, and a disabled type must not
  // deliver just because a row survived the flag change.
  if (!def.enabled) return { skip: 'type_disabled' }

  const resolved = resolveRecipients({
    rule: def.recipients,
    agencyId: job.agencyId,
    leadId: leadIdForJob(job),
    context,
  })
  if (resolved.length === 0) return { skip: 'no_recipients' }

  /**
   * NEVER NOTIFY A USER ABOUT THEIR OWN ACTION (spec §6.3).
   *
   * Applied PER RECIPIENT, not to the whole job: an admin who creates a lead and
   * assigns it to someone else still generates a notification for the assignee —
   * just not for themselves. `actorUserId` is null for system events (webhooks,
   * cron), in which case nobody is dropped.
   */
  const recipients = job.actorUserId == null ? resolved : resolved.filter((userId) => userId !== job.actorUserId)
  if (recipients.length === 0) return { skip: 'actor_only' }

  const occurredAt = new Date(job.createdAt)
  const plans: RecipientPlan[] = []

  for (const userId of recipients) {
    const channels = resolveChannels({
      policy: def.channels,
      presence: presence(userId),
      capabilities,
      priority: def.basePriority,
      preferences: preferences?.(userId, def.category),
    })
    // Every channel filtered out means there is nothing to deliver to this
    // person. Silence is a valid outcome (care-charter Law 4) — the row is not
    // written just so something exists.
    if (channels.length === 0) continue

    const context: EventContext = {
      type: job.type,
      agencyId: job.agencyId,
      entityType: job.entityType,
      entityId: job.entityId,
      actorUserId: job.actorUserId,
      occurredAt,
      payload: job.payload,
      groupCount: 1,
    }

    plans.push({ userId, channels, title: def.title(context), body: def.body(context), context })
  }

  if (plans.length === 0) return { skip: 'no_channels' }

  const first = plans[0].context
  const entity = def.entity(first)
  return {
    plan: {
      type: job.type,
      category: def.category,
      priority: def.basePriority,
      collapseKey: def.collapseKey(first),
      entityType: entity.type,
      entityId: entity.id,
      deepLink: def.deepLink(first),
      metadata: job.payload,
      recipients: plans,
    },
  }
}

/**
 * Rebuild copy against the count the database actually landed on.
 *
 * Only `message.inbound_multiple` reads groupCount, so for every other type this
 * returns exactly what was already written and the caller skips the update. See
 * updateNotificationCopy in db/notifications/notifications.ts for why the count
 * cannot be known before the upsert.
 */
export function rebuildCopyForGroupCount(
  type: NotificationType,
  context: EventContext,
  groupCount: number,
): { title: string; body: string | null } | null {
  const def = getNotificationType(type)
  if (!def) return null
  const withCount: EventContext = { ...context, groupCount }
  return { title: def.title(withCount), body: def.body(withCount) }
}
