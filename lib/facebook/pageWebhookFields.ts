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
