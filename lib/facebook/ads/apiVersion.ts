/**
 * The Marketing API version every ads read uses — pinned HERE, independently
 * of the app-wide META_GRAPH_VERSION.
 *
 * WHY. The app-wide default is `v19.0` (lib/facebook/graph.ts), and Marketing
 * API v19.0 was removed on 2025-02-04 (Meta: "Introducing Graph API v20.0 and
 * Marketing API v20.0"). A removed version is auto-upgraded at best and fails
 * at worst — it is not a version anyone tests against. The ads report was
 * verified field-by-field against a real v26.0 response on 2026-10-05
 * (__tests__/adsReporting/realV26Response.test.ts), so ads pin that version.
 *
 * WHY NOT CHANGE META_GRAPH_VERSION. It also drives Lead Ads, Page discovery,
 * Messenger, comments, WhatsApp and the Conversions API; moving them is a
 * separate, separately tested change.
 *
 * `META_ADS_API_VERSION` may override it (an explicit, ads-only knob for the
 * next upgrade); anything not shaped like `vNN.N` is ignored.
 */
export const DEFAULT_ADS_API_VERSION = 'v26.0'

export function resolveAdsApiVersion(raw: string | undefined): string {
  const v = (raw ?? '').trim()
  return /^v\d{1,3}\.\d$/.test(v) ? v : DEFAULT_ADS_API_VERSION
}

export const ADS_API_VERSION = resolveAdsApiVersion(process.env.META_ADS_API_VERSION)
