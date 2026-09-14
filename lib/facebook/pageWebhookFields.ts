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

/** Every field this Page must be subscribed to. Always a superset of the required pair. */
export function pageWebhookFieldList(opts: { grantedScopes: readonly string[]; messengerEnabled: boolean }): string[] {
  const fields: string[] = [...FACEBOOK_PAGE_REQUIRED_WEBHOOK_FIELDS]
  if (opts.messengerEnabled && opts.grantedScopes.includes('pages_messaging')) {
    fields.push(...MESSENGER_WEBHOOK_FIELDS)
  }
  return fields
}

/** The `subscribed_fields` value for this Page. */
export function pageWebhookFields(opts: { grantedScopes: readonly string[]; messengerEnabled: boolean }): string {
  return pageWebhookFieldList(opts).join(',')
}
