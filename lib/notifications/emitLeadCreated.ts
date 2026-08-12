/**
 * Shared lead.created emission door — EVENT COVERAGE Task 1.
 *
 * Sources (manual, Facebook, WhatsApp, CF7, reconcile) call this after a
 * successful lead INSERT. Import stays silent here so backfills never become
 * bell rows. insertLeadSystem stays pure; silence policy lives at callers.
 */

import type { Knex } from 'knex'
import { notifyEvent, type NotifyResult } from '@/lib/notifications/emit'

export type LeadCreatedEmitOrigin =
  | 'manual'
  | 'import'
  | 'webhook_facebook'
  | 'webhook_whatsapp'
  | 'webhook' // CF7 / generic signed website
  | 'reconcile'

export type EmitLeadCreatedArgs = {
  agencyId: number
  leadId: number
  leadName: string | null
  actorUserId: number | null
  occurredAt: Date
  origin: LeadCreatedEmitOrigin
}

export type EmitLeadCreatedResult = {
  enqueued: boolean
  skipped: 'silent_origin' | 'duplicate' | 'kill_switch' | 'not_allowlisted' | 'type_disabled' | null
}

/** Import is the only live origin that must not notify (backfill ≠ business moment). */
export function shouldEmitLeadCreated(origin: LeadCreatedEmitOrigin): boolean {
  return origin !== 'import'
}

function mapNotifyResult(result: NotifyResult): EmitLeadCreatedResult {
  // Discriminate on the literal boolean (`=== true` / else), not truthiness —
  // otherwise TS keeps the full NotifyResult union and rejects `.reason`.
  if (result.enqueued === true) return { enqueued: true, skipped: null }
  switch (result.reason) {
    case 'duplicate':
      return { enqueued: false, skipped: 'duplicate' }
    case 'kill_switch':
      return { enqueued: false, skipped: 'kill_switch' }
    case 'agency_not_allowlisted':
      return { enqueued: false, skipped: 'not_allowlisted' }
    case 'type_disabled':
    case 'unknown_type':
      return { enqueued: false, skipped: 'type_disabled' }
    case 'error':
    default:
      // notifyEvent already swallowed the error; treat as not enqueued without
      // inventing a new skip vocabulary beyond the Task 1 contract.
      return { enqueued: false, skipped: 'type_disabled' }
  }
}

export async function emitLeadCreated(
  args: EmitLeadCreatedArgs,
  opts?: { trx?: Knex.Transaction },
): Promise<EmitLeadCreatedResult> {
  if (!shouldEmitLeadCreated(args.origin)) {
    return { enqueued: false, skipped: 'silent_origin' }
  }

  const result = await notifyEvent(
    {
      type: 'lead.created',
      agencyId: args.agencyId,
      entityType: 'lead',
      entityId: args.leadId,
      actorUserId: args.actorUserId,
      occurredAt: args.occurredAt,
      payload: { leadName: args.leadName },
    },
    opts,
  )

  return mapNotifyResult(result)
}
