import type { Knex } from 'knex'
import { db } from '@/config/db'

/**
 * sales_quote_events: who did what to which version of a quote. Append-only.
 * `detail` carries ids, codes and amounts, never a phone number, a link or a
 * customer's words. System-level: the caller resolved the agency.
 */

export type QuoteEventType =
  | 'preview_offered'
  | 'preview_blocked'
  | 'edited'
  | 'send_declined'
  | 'send_accepted'
  | 'send_failed'
  | 'send_unknown'
  | 'delivered'
  | 'read'
  | 'delivery_failed'
  | 'link_opened'

export async function recordQuoteEvent(
  input: { agencyId: number; quoteId: number; quoteVersion: number; type: QuoteEventType; actorUserId?: number | null; actionId?: string | null; detail?: Record<string, unknown> },
  executor: Knex | Knex.Transaction = db,
): Promise<void> {
  await executor('sales_quote_events').insert({
    agencyId: input.agencyId,
    quoteId: input.quoteId,
    quoteVersion: input.quoteVersion,
    type: input.type,
    actorUserId: input.actorUserId ?? null,
    actionId: input.actionId ?? null,
    detail: JSON.stringify(input.detail ?? {}),
  })
}
