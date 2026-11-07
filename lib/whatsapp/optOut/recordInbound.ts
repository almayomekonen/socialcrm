import { recordInboundOptOutCommand, type OptOutCommandOutcome } from '@/db/whatsappOptOuts'
import { classifyOptOutCommand } from '@/lib/whatsapp/optOut/command'
import { toCustomerPhoneE164 } from '@/lib/whatsapp/optOut/phone'

/**
 * Record an inbound opt-out or re-opt-in command, for every business, whatever
 * its agent mode, questionnaire state or AI setting. Called by the inbound
 * ingest before the message itself is stored.
 *
 * Only a message the customer TYPED counts (`type: 'text'`). A tapped button or
 * list row carries a title this business wrote, so it is never a command.
 *
 * It runs in its own short transaction, so the exclusive opt-out lock is never
 * taken while the ingest holds conversation or message row locks. A failure
 * propagates: the durable webhook receipt is retried, and a redelivery is
 * recognised by its wamid and recorded once.
 *
 * Logs carry the agency, the command and the outcome — never the number or text.
 */
export async function recordInboundOptOut(input: {
  agencyId: number
  customerWaId: string
  type: string
  text: string
  externalId: string | null
  channelTimestamp: Date | null
}): Promise<OptOutCommandOutcome | null> {
  if (input.type !== 'text') return null
  const command = classifyOptOutCommand(input.text)
  if (!command) return null
  const phone = toCustomerPhoneE164(input.customerWaId)
  if (!phone || !input.externalId) {
    console.warn('[optOut] command not recordable', { agencyId: input.agencyId, command, phone: !!phone, id: !!input.externalId })
    return null
  }
  const { outcome, skippedPendingJobs } = await recordInboundOptOutCommand({
    agencyId: input.agencyId,
    customerPhoneE164: phone,
    command,
    eventAt: input.channelTimestamp ?? new Date(),
    messageExternalId: input.externalId,
  })
  console.log('[optOut] command', { agencyId: input.agencyId, command, outcome, skippedPendingJobs })
  return outcome
}
