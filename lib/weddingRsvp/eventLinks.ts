import { db } from '@/config/db'
import { WEDDING_RSVP_SOURCE, isWeddingAgency } from '@/lib/weddingRsvp/config'
import { replyInConversation } from '@/lib/weddingRsvp/reply'

/**
 * TEMPORARY, like the rest of lib/weddingRsvp. After a guest's head count has been
 * answered with the thank-you, three CTA messages: Waze, then the two gift options
 * (Bit, PayBox). A Cloud API `cta_url` message carries exactly one URL button, so
 * each link is its own message. WEDDING_WAZE_URL, WEDDING_BIT_URL and
 * WEDDING_PAYBOX_URL must all be valid HTTPS links, or nothing is sent.
 *
 * Every guest who completes the RSVP flow gets them: whoever reached the thank-you
 * already passed the RSVP follow-up gate (allowlist or a template RSVP request).
 */

export const EVENT_LINKS_STEP = 'event_links'
export const EVENT_LINKS_CLAIM_KEY = 'eventLinksClaimedAt'

type EventLinks = { waze: string; bit: string; paybox: string }

/** The string exactly as configured, or null. It is sent verbatim, so it must already be a complete link. */
function readHttpsUrl(value: string | undefined): string | null {
  const url = value?.trim()
  if (!url || /\s/.test(url) || !/^https:\/\//i.test(url)) return null
  try {
    return new URL(url).hostname ? url : null
  } catch {
    return null
  }
}

/** `invalid` holds variable names only: the values must never reach a log. */
export function readEventLinks(): { links: EventLinks | null; invalid: string[] } {
  const waze = readHttpsUrl(process.env.WEDDING_WAZE_URL)
  const bit = readHttpsUrl(process.env.WEDDING_BIT_URL)
  const paybox = readHttpsUrl(process.env.WEDDING_PAYBOX_URL)
  const invalid = [
    ...(waze ? [] : ['WEDDING_WAZE_URL']),
    ...(bit ? [] : ['WEDDING_BIT_URL']),
    ...(paybox ? [] : ['WEDDING_PAYBOX_URL']),
  ]
  return { links: waze && bit && paybox ? { waze, bit, paybox } : null, invalid }
}

export type EventLinkMessage = { link: 'waze' | 'bit' | 'paybox'; body: string; label: string; url: string }

/** In send order: navigation, then the two gift options. Meta limits a button label to 20 characters. */
export function eventLinkMessages({ waze, bit, paybox }: EventLinks): EventLinkMessage[] {
  return [
    { link: 'waze', body: 'ניווט לאירוע:\nSERA – סרה, עמק האלה', label: 'פתיחת Waze', url: waze },
    { link: 'bit', body: 'למי שרוצה לשלוח מתנה 💝', label: 'שליחת מתנה ב-Bit', url: bit },
    {
      link: 'paybox',
      body: 'השימוש ב-PayBox חינם!\nמחכים לך בקבוצת ״מתנה לחתונה A | F״,\nלחיצה להצטרפות לקבוצה:',
      label: 'הצטרפות ב-PayBox',
      url: paybox,
    },
  ]
}

/** The Cloud API `interactive` object for one CTA URL button. */
export function ctaUrlInteractive({ body, label, url }: EventLinkMessage): Record<string, unknown> {
  return { type: 'cta_url', body: { text: body }, action: { name: 'cta_url', parameters: { display_text: label, url } } }
}

/** What the conversation shows: the body plus the button, as the RSVP buttons are stored. */
export function eventLinkStoredText({ body, label }: EventLinkMessage): string {
  return `${body}\n\n[${label}]`
}

/**
 * Stamps the latest thank-you with a claim BEFORE Meta is called; true only for the
 * caller that wrote it. Once per conversation, across every thank-you it has had.
 *
 * Callers hold the conversation lock. Independently of it, the condition on the
 * target row is rechecked by Postgres after waiting on that row's lock, so two
 * concurrent claims on one row cannot both succeed.
 */
async function claimEventLinks(agencyId: number, conversationId: number): Promise<boolean> {
  const result = await db.raw(
    `UPDATE inbox_messages
        SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('${EVENT_LINKS_CLAIM_KEY}', now())
      WHERE id = (
              SELECT id FROM inbox_messages
               WHERE "agencyId" = ? AND "conversationId" = ? AND direction = 'outbound' AND status <> 'failed'
                 AND metadata->>'source' = ? AND metadata->>'step' = 'thanks'
               ORDER BY id DESC
               LIMIT 1
            )
        AND metadata->>'${EVENT_LINKS_CLAIM_KEY}' IS NULL
        AND NOT EXISTS (
              SELECT 1 FROM inbox_messages claimed
               WHERE claimed."agencyId" = ? AND claimed."conversationId" = ?
                 AND claimed.metadata->>'${EVENT_LINKS_CLAIM_KEY}' IS NOT NULL
            )
      RETURNING id`,
    [agencyId, conversationId, WEDDING_RSVP_SOURCE, agencyId, conversationId],
  )
  return result.rows.length === 1
}

/**
 * Call ONLY after the thank-you succeeded, inside the conversation lock that sent
 * it. That success is also the proof the 24-hour window is open: the guest's
 * answer opened it moments ago, and a closed window would have failed the
 * thank-you first.
 *
 * AT MOST ONCE PER CONVERSATION. A send can reach the guest with no record of it
 * here (a timeout, a response with no message id, a failed save), so the claim is
 * written first and never released. One claim covers all three messages. The cost is
 * deliberate: a refused send or a crash after claiming leaves that guest without
 * some or all of the links, even if they confirm again. Configuration is checked
 * before claiming, so it never spends the claim.
 *
 * The first failure ends the sequence and is logged with the link it stopped at.
 *
 * Never throws: the RSVP is already complete and nothing here may affect it. Only
 * the error's name is logged, because an error can quote the data it failed on.
 */
export async function sendEventLinksAfterThanks(args: {
  agencyId: number
  conversationId: number
  leadId: number | null
}): Promise<void> {
  let link: EventLinkMessage['link'] | null = null
  try {
    if (!isWeddingAgency(args.agencyId)) return
    const { links, invalid } = readEventLinks()
    if (!links) {
      console.warn('[WeddingRsvp] event links disabled: missing or invalid configuration', { invalid })
      return
    }
    if (!(await claimEventLinks(args.agencyId, args.conversationId))) return

    for (const message of eventLinkMessages(links)) {
      link = message.link
      const outcome = await replyInConversation({
        agencyId: args.agencyId,
        conversationId: args.conversationId,
        leadId: args.leadId,
        body: message.body,
        interactive: ctaUrlInteractive(message),
        storedText: eventLinkStoredText(message),
        metadata: { step: EVENT_LINKS_STEP, link: message.link },
      })
      if ('reason' in outcome) {
        console.error('[WeddingRsvp] event links not sent', { conversationId: args.conversationId, link, reason: outcome.reason })
        return
      }
    }
  } catch (err) {
    console.error('[WeddingRsvp] event links failed', {
      conversationId: args.conversationId,
      link,
      error: err instanceof Error ? err.name : 'unknown',
    })
  }
}
