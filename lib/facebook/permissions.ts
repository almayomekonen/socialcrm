import { parseAllowlist } from '@/lib/facebook/comments/capability'

/**
 * Meta permissions, requested per feature.
 *
 * The Page connection keeps asking for exactly what Lead Ads and comment text
 * already needed. Each additional capability asks for its own permissions only
 * when the user starts THAT feature, which is what Meta App Review expects and
 * what keeps the consent screen honest about why each permission is needed.
 *
 * Dependencies follow https://developers.facebook.com/docs/permissions
 * (checked 2026-09-14):
 *   pages_manage_engagement → pages_read_user_content, pages_show_list
 *   pages_messaging         → pages_manage_metadata, pages_show_list
 *   ads_read                → (none)
 *
 * A granted set is only ever what Meta reported for the token (`/me/permissions`
 * status=granted, persisted on the row). Nothing here guesses a grant.
 */

/** What the Page connection requested before per-feature permissions existed. Unchanged. */
export const BASE_PAGE_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
  'leads_retrieval',
  'pages_read_user_content',
] as const

export type MetaPageFeature = 'comment_replies' | 'messenger'
export type MetaFeature = MetaPageFeature | 'ads'

export const FEATURE_SCOPES: Record<MetaFeature, readonly string[]> = {
  comment_replies: ['pages_manage_engagement', 'pages_read_user_content', 'pages_show_list'],
  messenger: ['pages_messaging', 'pages_manage_metadata', 'pages_show_list'],
  ads: ['ads_read'],
}

export function parsePageFeature(raw: string | null | undefined): MetaPageFeature | null {
  return raw === 'comment_replies' || raw === 'messenger' ? raw : null
}

/** OAuth `scope` for the Page connection: the unchanged base plus the feature's own permissions. */
export function pageOAuthScopes(feature: MetaPageFeature | null): string[] {
  const scopes = new Set<string>(BASE_PAGE_SCOPES)
  if (feature) for (const s of FEATURE_SCOPES[feature]) scopes.add(s)
  return [...scopes]
}

export function missingFeatureScopes(granted: readonly string[], feature: MetaFeature): string[] {
  const have = new Set(granted)
  return FEATURE_SCOPES[feature].filter((s) => !have.has(s))
}

export function hasFeatureScopes(granted: readonly string[], feature: MetaFeature): boolean {
  return missingFeatureScopes(granted, feature).length === 0
}

function gate(enabledVar: string | undefined, allowlistVar: string | undefined, agencyId: number | null | undefined) {
  if (typeof agencyId !== 'number') return false
  if (enabledVar !== '1') return false
  const list = parseAllowlist(allowlistVar)
  return list === 'all' || list.includes(agencyId)
}

/**
 * Our rollout gate for REPLYING to comments from SocialCRM. Separate from
 * FACEBOOK_COMMENTS_ENABLED on purpose: comment ingestion is an existing,
 * enabled integration, and replies must be switchable on and off without
 * touching it. Replies still also require the comments gate and the grant.
 */
export function isFacebookCommentRepliesEnabledForAgency(agencyId: number | null | undefined): boolean {
  return gate(
    process.env.FACEBOOK_COMMENT_REPLIES_ENABLED,
    process.env.FACEBOOK_COMMENT_REPLIES_AGENCY_ALLOWLIST,
    agencyId,
  )
}

/** Our rollout gate for Messenger. Unset ⇒ OFF everywhere. */
export function isFacebookMessengerEnabledForAgency(agencyId: number | null | undefined): boolean {
  return gate(process.env.FACEBOOK_MESSENGER_ENABLED, process.env.FACEBOOK_MESSENGER_AGENCY_ALLOWLIST, agencyId)
}

/** Our rollout gate for ad performance reporting. Unset ⇒ OFF everywhere. */
export function isFacebookAdsReportingEnabledForAgency(agencyId: number | null | undefined): boolean {
  return gate(
    process.env.FACEBOOK_ADS_REPORTING_ENABLED,
    process.env.FACEBOOK_ADS_REPORTING_AGENCY_ALLOWLIST,
    agencyId,
  )
}
