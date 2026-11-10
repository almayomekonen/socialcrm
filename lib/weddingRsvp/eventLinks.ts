import { db } from '@/config/db'
import { WEDDING_RSVP_SOURCE, isWeddingAgency } from '@/lib/weddingRsvp/config'
import { replyInConversation } from '@/lib/weddingRsvp/reply'

/**
 * TEMPORARY, like the rest of lib/weddingRsvp. After a guest's head count has been
 * answered with the thank-you, exactly TWO messages:
 *   1. Waze — a free-form `cta_url` interactive (one URL button, WEDDING_WAZE_URL).
 *   2. Gifts — the approved template GIFT_TEMPLATE, ONE message with TWO URL buttons
 *      (Bit, PayBox). A `cta_url` interactive can carry only one URL button; a
 *      template can carry two. Both URLs are static parts of the approved template
 *      at Meta, so nothing about them is configured or sent from here.
 * WEDDING_WAZE_URL must be a valid HTTPS link, or nothing is sent.
 *
 * Every guest who completes the RSVP flow gets them: whoever reached the thank-you
 * already passed the RSVP follow-up gate (allowlist or a template RSVP request).
 */

export const EVENT_LINKS_STEP = 'event_links'
export const EVENT_LINKS_CLAIM_KEY = 'eventLinksClaimedAt'

/**
 * The gift template, as approved on the wedding WABA (Hebrew, MARKETING): a static
 * BODY and two static URL buttons, no variables — so a send names it and nothing else.
 *   BODY      למי שרוצה לשלוח מתנה לחתונה 💝
 *   BUTTON 1  URL  "שליחת מתנה ב-Bit"   → the Bit group link
 *   BUTTON 2  URL  "הצטרפות ב-PayBox"   → https://links.payboxapp.com/EvZawEB4W7b
 */
export const GIFT_TEMPLATE = {
  name: 'wedding_gift_links',
  language: 'he',
  body: 'למי שרוצה לשלוח מתנה לחתונה 💝',
  buttons: ['שליחת מתנה ב-Bit', 'הצטרפות ב-PayBox'],
} as const

type EventLinks = { waze: string }

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
  return { links: waze ? { waze } : null, invalid: waze ? [] : ['WEDDING_WAZE_URL'] }
}

export type WazeMessage = { kind: 'cta'; link: 'waze'; body: string; label: string; url: string }
export type GiftMessage = {
  kind: 'template'
  link: 'gift'
  body: string
  labels: readonly string[]
  template: { name: string; language: string }
}
export type EventLinkMessage = WazeMessage | GiftMessage

/** In send order: navigation, then ONE gift message with both options. */
export function eventLinkMessages({ waze }: EventLinks): EventLinkMessage[] {
  return [
    { kind: 'cta', link: 'waze', body: 'ניווט לאירוע:\nSERA – סרה, עמק האלה', label: 'פתיחת Waze', url: waze },
    {
      kind: 'template',
      link: 'gift',
      body: GIFT_TEMPLATE.body,
      labels: GIFT_TEMPLATE.buttons,
      template: { name: GIFT_TEMPLATE.name, language: GIFT_TEMPLATE.language },
    },
  ]
}

/** The Cloud API `interactive` object for one CTA URL button. Meta limits the label to 20 characters. */
export function ctaUrlInteractive({ body, label, url }: WazeMessage): Record<string, unknown> {
  return { type: 'cta_url', body: { text: body }, action: { name: 'cta_url', parameters: { display_text: label, url } } }
}

/** What the conversation shows: the body plus its buttons, as the RSVP buttons are stored. Never a URL. */
export function eventLinkStoredText(message: EventLinkMessage): string {
  const labels = message.kind === 'cta' ? [message.label] : message.labels
  return `${message.body}\n\n${labels.map((l) => `[${l}]`).join(' ')}`
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
 * written first and never released. One claim covers both messages. The cost is
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
        ...(message.kind === 'cta' ? { interactive: ctaUrlInteractive(message) } : { template: message.template }),
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
