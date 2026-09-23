/**
 * Page-level webhook fields for SocialCRM's Facebook Page connection.
 *
 * Meta's POST /{page-id}/subscribed_apps REPLACES the field set. Always send
 * both required fields together so reconnect/repair never strips one of them.
 *
 * - leadgen — Lead Ads intake (existing, must not regress)
 * - feed    — Page comments / reactions for Facebook Comments MVP
 */
export const FACEBOOK_PAGE_WEBHOOK_FIELDS = 'leadgen,feed' as const

/** Individual fields SocialCRM requires for a Page to be considered subscribed. */
export const FACEBOOK_PAGE_REQUIRED_WEBHOOK_FIELDS = ['leadgen', 'feed'] as const

/**
 * Messenger fields (https://developers.facebook.com/docs/messenger-platform/webhooks):
 * `messages` for inbound customer messages, `message_echoes` for messages the
 * Page sent — from SocialCRM or from Meta Business Suite — so the thread stays
 * complete. Subscribing them requires `pages_messaging` on the token; asking
 * without it fails the WHOLE subscribe call, which would take Lead Ads down
 * with it. So they are added only when the grant is recorded on the row AND
 * Messenger is rolled out to the agency.
 */
export const MESSENGER_WEBHOOK_FIELDS = ['messages', 'message_echoes'] as const

/**
 * Messenger fields that IMPROVE the experience but are not needed for it to
 * work. Delivery/read receipts, postbacks (Get Started, persistent menu, button
 * taps), referrals (m.me links and ads), and reactions. All are ordinary Page
 * webhook fields requiring only `pages_messaging`
 * (https://developers.facebook.com/docs/messenger-platform/reference/webhook-events,
 * checked 2026-09-23).
 *
 * They are a SEPARATE TIER on purpose. Meta replaces the whole field set on
 * every subscribe and rejects the entire call if it dislikes one name, so a
 * field that a future Graph version renames or gates would otherwise take
 * `messages` — and `leadgen` — down with it. The repair path falls back
 * full set → core Messenger → leadgen,feed, so the blast radius of a refused
 * enhancement is the enhancement.
 */
export const MESSENGER_SIGNAL_FIELDS = [
  'message_deliveries',
  'message_reads',
  'messaging_postbacks',
  'messaging_referrals',
  'message_reactions',
] as const

/** Every field this Page must be subscribed to. Always a superset of the required pair. */
export function pageWebhookFieldList(opts: { grantedScopes: readonly string[]; messengerEnabled: boolean }): string[] {
  const fields: string[] = [...FACEBOOK_PAGE_REQUIRED_WEBHOOK_FIELDS]
  if (opts.messengerEnabled && opts.grantedScopes.includes('pages_messaging')) {
    fields.push(...MESSENGER_WEBHOOK_FIELDS, ...MESSENGER_SIGNAL_FIELDS)
  }
  return fields
}

/**
 * The fields whose absence means Messenger is genuinely BROKEN, as opposed to
 * merely less informative.
 *
 * This is what the Messenger tab's readiness check judges against. Without it,
 * a Page missing only `message_reactions` would be reported as "not subscribed"
 * and the rep would be shown a reconnect prompt forever, for a capability they
 * never noticed. Repair still tries to subscribe the full set — it just does not
 * call the Page unhealthy for the difference.
 */
export function pageEssentialFieldList(opts: {
  grantedScopes: readonly string[]
  messengerEnabled: boolean
}): string[] {
  const fields: string[] = [...FACEBOOK_PAGE_REQUIRED_WEBHOOK_FIELDS]
  if (opts.messengerEnabled && opts.grantedScopes.includes('pages_messaging')) {
    fields.push(...MESSENGER_WEBHOOK_FIELDS)
  }
  return fields
}

/** The core Messenger field set — the fallback tier between "everything" and "Lead Ads only". */
export function messengerCoreFields(): string {
  return [...FACEBOOK_PAGE_REQUIRED_WEBHOOK_FIELDS, ...MESSENGER_WEBHOOK_FIELDS].join(',')
}

/** The `subscribed_fields` value for this Page. */
export function pageWebhookFields(opts: { grantedScopes: readonly string[]; messengerEnabled: boolean }): string {
  return pageWebhookFieldList(opts).join(',')
}
