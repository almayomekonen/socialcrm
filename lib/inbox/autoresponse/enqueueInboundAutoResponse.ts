import type { Knex } from 'knex'
import { enqueueAutoResponse, type AutoResponseReason } from '@/db/autoResponseJobs'

export type UnansweredInbound = {
  id: number
  sequence: number
}

export type LatestMessage = {
  id: number
  direction: string
  sequence: number
}

/**
 * Latest message wins. An inbound with no later outbound is unanswered.
 * Multiple unanswered inbounds collapse to the latest inbound only.
 */
export function unansweredInboundFromLatest(last: LatestMessage | null | undefined): UnansweredInbound | null {
  if (!last) return null
  if (last.direction !== 'inbound') return null
  const sequence = Number(last.sequence)
  const id = Number(last.id)
  if (!Number.isFinite(id) || id <= 0) return null
  if (!Number.isFinite(sequence) || sequence < 0) return null
  return { id, sequence }
}

export async function findLatestUnansweredInbound(
  trx: Knex.Transaction,
  conversationId: number,
): Promise<UnansweredInbound | null> {
  const last = await trx('inbox_messages')
    .where({ conversationId })
    .orderBy([
      { column: 'sequence', order: 'desc' },
      { column: 'id', order: 'desc' },
    ])
    .first('id', 'direction', 'sequence')
  return unansweredInboundFromLatest(last as LatestMessage | undefined)
}

export type EnqueueInboundAutoResponseResult = {
  jobId: number | null
  reason: AutoResponseReason
  delaySeconds: number
}

/**
 * Same IRE enqueue used by WhatsApp inbound ingest: settings → delaySeconds →
 * qualify_turn vs first_contact → enqueueAutoResponse (existing guards).
 */
export async function enqueueInboundAutoResponse(
  trx: Knex.Transaction,
  args: {
    agencyId: number
    conversationId: number
    leadId: number
    triggerSequence: number
  },
): Promise<EnqueueInboundAutoResponseResult> {
  const arSettings = await trx('auto_response_settings')
    .where({ agencyId: args.agencyId, channel: 'whatsapp' })
    .first('mode', 'delaySeconds')
  const delayRaw = Number(arSettings?.delaySeconds ?? 0)
  const delaySeconds = Number.isFinite(delayRaw) ? Math.min(Math.max(Math.floor(delayRaw), 0), 3600) : 0
  const reason: AutoResponseReason = arSettings?.mode === 'qualify' ? 'qualify_turn' : 'first_contact'
  const jobId = await enqueueAutoResponse(trx, {
    agencyId: args.agencyId,
    conversationId: args.conversationId,
    leadId: args.leadId,
    channel: 'whatsapp',
    triggerSequence: args.triggerSequence,
    reason,
    delaySeconds,
  })
  return { jobId, reason, delaySeconds }
}
