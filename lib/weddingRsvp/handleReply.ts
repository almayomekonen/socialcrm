import { REPLY_ATTENDING, REPLY_NOT_ATTENDING, REPLY_THANKS } from '@/lib/weddingRsvp/config'
import { followUpAllowed } from '@/lib/weddingRsvp/followUpAccess'
import { getWeddingRsvpChoice, type WeddingRsvpChoice } from '@/lib/weddingRsvp/choice'
import { isHeadCountAnswer, parseHeadCount } from '@/lib/weddingRsvp/headCount'
import { findLatestOutbound, withConversationLock } from '@/lib/weddingRsvp/history'
import { replyInConversation } from '@/lib/weddingRsvp/reply'
import { sendEventLinksAfterThanks } from '@/lib/weddingRsvp/eventLinks'

export type WeddingRsvpRouteResult =
  | { handled: false }
  | { handled: true; choice: WeddingRsvpChoice; replied: boolean; reason?: string }
  | { handled: true; headCount: number; replied: boolean; reason?: string }

/**
 * Webhook hook. Called for every NEWLY inserted inbound `interactive`, `button` or `text`
 * message (a webhook retry is never "newly inserted", so it never re-enters).
 * Returns `{ handled: false }` for everything that is not part of the RSVP flow:
 *
 *   tap 'מגיע/ה'      → REPLY_ATTENDING (head-count question)
 *   tap 'לא מגיע/ה' / template 'לצערי לא' → REPLY_NOT_ATTENDING
 *   number, while the head-count question is still the latest outbound → REPLY_THANKS, once
 *
 * The inbound itself is already stored by the normal ingest. Never throws.
 */
export async function routeWeddingRsvpReply(args: {
  agencyId: number
  conversationId: number
  leadId: number | null
  messageId: number
  rawMessage: unknown
}): Promise<WeddingRsvpRouteResult> {
  const choice = getWeddingRsvpChoice(args.rawMessage)
  if (choice) {
    try {
      const body = choice === 'attending' ? REPLY_ATTENDING : REPLY_NOT_ATTENDING
      const outcome = await replyInConversation({ ...args, body, metadata: { step: choice } })
      return { handled: true, choice, ...outcome }
    } catch (err) {
      console.error('[WeddingRsvp] reply handling failed', { conversationId: args.conversationId, err: String(err) })
      return { handled: true, choice, replied: false, reason: 'error' }
    }
  }

  // Cheap, DB-free filters first: every text message in the product passes here.
  const headCount = parseHeadCount(args.rawMessage)
  if (headCount == null) return { handled: false }
  if (!(await followUpAllowed((args.rawMessage as { from?: string }).from, args.conversationId))) return { handled: false }

  try {
    return await withConversationLock(args.conversationId, async () => {
      const latest = await findLatestOutbound(args.agencyId, args.conversationId)
      if (!isHeadCountAnswer(latest, args.messageId, new Date())) return { handled: false } as const
      const outcome = await replyInConversation({ ...args, body: REPLY_THANKS, metadata: { step: 'thanks', headCount } })
      if (outcome.replied) await sendEventLinksAfterThanks(args)
      return { handled: true, headCount, ...outcome } as const
    })
  } catch (err) {
    console.error('[WeddingRsvp] head-count handling failed', { conversationId: args.conversationId, err: String(err) })
    return { handled: true, headCount, replied: false, reason: 'error' }
  }
}
