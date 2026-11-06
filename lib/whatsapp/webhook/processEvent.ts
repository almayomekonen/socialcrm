import { db } from '@/config/db'
import { handleInboundWebhookMessage } from '@/lib/whatsapp/handleInboundWebhookMessage'
import { ingestWhatsappStatuses } from '@/lib/inbox/ingestWhatsappStatuses'
import { ingestWhatsappEchoes } from '@/lib/inbox/ingestWhatsappEcho'
import type { WhatsappEventKind } from '@/db/whatsappWebhookEvents'

/**
 * Apply ONE WhatsApp event. The single implementation behind both modes: the durable
 * worker calls it for a claimed receipt, and the direct (kill switch) path calls it
 * inside the request. So signature checks happen before it, and tenancy, duplicate
 * protection and (once it exists) opt-out enforcement are identical in both modes.
 *
 * TENANCY. The connection is looked up by phone_number_id now, and must still belong to
 * the agency the receipt was recorded for. A number that moved or was disconnected
 * since is ignored, never applied to the new owner.
 *
 * FAILURE. Anything that did not commit throws `RetryableEventError`: the worker retries
 * it with backoff, the direct path answers 503. Duplicates are not failures.
 */

export class RetryableEventError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = 'RetryableEventError'
  }
}

export type EventInput = { agencyId: number | null; phoneNumberId: string; kind: WhatsappEventKind; payload: unknown }
export type EventOutcome = { outcome: 'processed' | 'ignored'; detail: string; kick: boolean; delaySeconds: number }

const ignored = (detail: string): EventOutcome => ({ outcome: 'ignored', detail, kick: false, delaySeconds: 0 })

export async function processWhatsappEvent(input: EventInput): Promise<EventOutcome> {
  let connection: Record<string, unknown> | undefined
  try {
    connection = await db('whatsapp_connections').where({ phone_number_id: input.phoneNumberId }).first()
  } catch {
    throw new RetryableEventError('connection_lookup_failed')
  }
  if (!connection) return ignored('no_connection')
  if (input.agencyId != null && Number(connection.agency_id) !== input.agencyId) return ignored('connection_changed_agency')

  const payload = (input.payload ?? {}) as Record<string, unknown>

  if (input.kind === 'message') {
    const message = payload.message as Record<string, unknown> | undefined
    if (!message?.id || !message?.from) return ignored('malformed_message')
    const r = await handleInboundWebhookMessage({
      message: message as never,
      phoneNumberId: input.phoneNumberId,
      profileName: typeof payload.profileName === 'string' ? payload.profileName : null,
      connection: connection as never,
    })
    if (!r.persisted) throw new RetryableEventError('message_not_persisted')
    return { outcome: 'processed', detail: r.kick ? 'stored_reply_queued' : 'stored', kick: r.kick, delaySeconds: r.delaySeconds }
  }

  if (input.kind === 'echo') {
    const r = await ingestWhatsappEchoes(payload)
    if (r.errored > 0 || r.skipped > 0) throw new RetryableEventError('echo_not_persisted')
    return { outcome: 'processed', detail: r.duplicates > 0 ? 'duplicate' : 'stored', kick: false, delaySeconds: 0 }
  }

  const r = await ingestWhatsappStatuses(input.phoneNumberId, [payload.status])
  if (r.errored > 0) throw new RetryableEventError('status_not_applied')
  if (r.noConnection) return ignored('no_connection')
  return { outcome: 'processed', detail: 'status', kick: false, delaySeconds: 0 }
}
