import { after } from 'next/server'
import { ingestMessengerEvent } from '@/lib/facebook/messenger/ingestMessengerEvent'
import { fillMessengerCustomerName } from '@/lib/facebook/messenger/profile'
import { describeDbError, isTransientDbError } from '@/lib/system/dbErrorInfo'

/**
 * One webhook entry's `messaging[]` events (Messenger), each handled on its own
 * so one bad event never strands a sibling.
 *
 * NEVER THROWS, and the route still answers 200. This callback URL also carries
 * Lead Ads (`leadgen`) and comments (`feed`): a non-2xx sustained for an hour
 * gets the whole app's webhook subscription disabled by Meta, Lead Ads
 * included — the same reason db/webhookFailures.ts never lets a ledger write
 * turn into a retry storm. A TRANSIENT database error (connection, deadlock,
 * shutdown) gets ONE immediate retry, which is safe because ("pageId", mid) is
 * unique; anything still failing is logged without content and acknowledged.
 * A durable retry ledger for Messenger events is a follow-up (schema change).
 */

const RETRY_DELAY_MS = 250

async function ingestWithOneRetry(pageId: string, event: unknown) {
  try {
    return await ingestMessengerEvent(pageId, event)
  } catch (err) {
    if (!isTransientDbError(err)) throw err
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    return ingestMessengerEvent(pageId, event)
  }
}

export async function handleMessagingEntries(pageId: string, events: unknown[]): Promise<{ failed: number }> {
  let failed = 0
  for (const event of events) {
    try {
      const result = await ingestWithOneRetry(pageId, event)
      if (result.status === 'stored' && result.direction === 'inbound' && result.newConversation) {
        const { conversationId, agencyId } = result
        after(() => fillMessengerCustomerName({ conversationId, agencyId, pageId }))
      }
    } catch (err) {
      failed++
      // PII-free: SQLSTATE/constraint only — never the message text or the sender.
      console.error('[Messenger] ingest failed — event acknowledged, not stored', {
        transient: isTransientDbError(err),
        db: describeDbError(err).summary,
      })
    }
  }
  return { failed }
}
