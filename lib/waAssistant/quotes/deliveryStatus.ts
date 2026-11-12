import 'server-only'
import { after } from 'next/server'
import { db } from '@/config/db'
import { applyQuoteDeliveryStatus, claimOwnerDeliveryNotice, type StatusApplied } from '@/db/quotes/deliveries'
import { isWaAssistantQuotesSendAgency } from '@/lib/flags/waAssistantFlags'
import { platformWhatsappAccessToken, platformWhatsappPhoneNumberId } from '@/lib/flags/ownerWhatsappReminderFlags'
import { quoteDeliveredNotice, quoteDeliveryFailedNotice } from './deliveryCopy'
import { tellApprovingOwner } from './ownerNotice'

/**
 * A WhatsApp delivery receipt for a quote the owner approved. NEVER THROWS: the
 * webhook must always answer. Agencies outside the pilot do no work at all.
 *
 * The owner hears once that it was delivered, and once if it failed, on the
 * platform number, at the verified recipient who tapped the card.
 */

async function tellOwner(applied: StatusApplied): Promise<void> {
  const { delivery, status } = applied
  const kind = status === 'failed' ? 'failed' : 'delivered'
  if (!platformWhatsappPhoneNumberId() || !platformWhatsappAccessToken()) return
  if (!(await claimOwnerDeliveryNotice(delivery.id, delivery.agencyId, kind))) return

  const quote = (await db('sales_quotes').where({ id: delivery.quoteId, agencyId: delivery.agencyId }).first('quoteNumber')) as { quoteNumber: number | string | null } | undefined
  const quoteNumber = quote?.quoteNumber == null ? null : Number(quote.quoteNumber)
  await tellApprovingOwner({ agencyId: delivery.agencyId, actionId: delivery.actionId, body: kind === 'failed' ? quoteDeliveryFailedNotice(quoteNumber) : quoteDeliveredNotice(quoteNumber), jobId: delivery.quoteId })
}

export async function onQuoteDeliveryReceipt(input: { agencyId: number; wamid: string; status: string; code?: string | null }): Promise<void> {
  try {
    if (!isWaAssistantQuotesSendAgency(input.agencyId)) return
    const applied = await applyQuoteDeliveryStatus(input)
    if (!applied || applied.status === 'read') return
    const job = () => tellOwner(applied).catch((err) => console.error('[quotes.delivery] notice.fail', (err as Error)?.name))
    try {
      after(job)
    } catch {
      // Outside a request scope (the durable webhook worker, a script or a test).
      await job()
    }
  } catch (err) {
    console.error('[quotes.delivery] receipt.fail', (err as Error)?.name)
  }
}
