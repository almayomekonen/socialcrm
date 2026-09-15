/**
 * What the ad report is showing, as it lives in the URL: account, date range and
 * the optional drill-down (campaign → ad set). Pure; shared by the server page
 * and the client shell, so both describe a selection with the SAME string.
 *
 * The key is built from the RAW query (not the server's normalized reading), so
 * "the report on screen answers the newest request" is a string comparison that
 * normalization (e.g. an until-date clamped to today) can never break.
 */

export type AdsSelectionQuery = {
  account?: string
  range?: string
  since?: string
  until?: string
  campaign?: string
  adset?: string
}

const ORDER = ['account', 'range', 'since', 'until', 'campaign', 'adset'] as const

/** Only the report's own parameters, in a fixed order; custom dates only with a custom range. */
export function adsSelectionParams(query: AdsSelectionQuery): URLSearchParams {
  const params = new URLSearchParams()
  for (const key of ORDER) {
    const value = query[key]?.trim()
    if (!value) continue
    if ((key === 'since' || key === 'until') && query.range !== 'custom') continue
    params.set(key, value)
  }
  return params
}

export function adsSelectionKey(query: AdsSelectionQuery): string {
  return adsSelectionParams(query).toString()
}

export function adsSelectionHref(pathname: string, query: AdsSelectionQuery): string {
  const qs = adsSelectionParams(query).toString()
  return qs ? `${pathname}?${qs}` : pathname
}

/**
 * Drill-down exits, as values that survive React Server Components serialization.
 * An `undefined` prop is DROPPED on the way from a server component to a client
 * component, so `{ campaign: undefined }` would arrive as `{}` and change nothing.
 * An empty string survives and is omitted from the URL like an absent value.
 */
export const CLEAR_DRILLDOWN: AdsSelectionQuery = { campaign: '', adset: '' }
export const CLEAR_ADSET: AdsSelectionQuery = { adset: '' }

/**
 * Apply a change. Changing the account or the dates leaves the drill-down: a
 * campaign id belongs to one account, and the question "which ad set" restarts
 * with the new numbers. Choosing a campaign clears a previously chosen ad set.
 */
export function nextAdsSelection(current: AdsSelectionQuery, change: AdsSelectionQuery): AdsSelectionQuery {
  const scopeChanged = ['account', 'range', 'since', 'until'].some(
    (k) => k in change && change[k as keyof AdsSelectionQuery] !== current[k as keyof AdsSelectionQuery],
  )
  const next = { ...current, ...change }
  if (scopeChanged) {
    if (!('campaign' in change)) delete next.campaign
    if (!('adset' in change)) delete next.adset
  } else if ('campaign' in change && change.campaign !== current.campaign && !('adset' in change)) {
    delete next.adset
  }
  return next
}
