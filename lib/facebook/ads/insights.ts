import { describeGraphError, graphRequest, type MetaGraphError } from '@/lib/facebook/graphClient'
import { toNumber } from '@/lib/facebook/ads/metrics'

/**
 * Read-only access to Meta's Marketing API through `ads_read`: the accounts this
 * user may read, and the shared insights reader the report and the drill-down
 * use. No mutation endpoint is called, and `ads_management` is never requested.
 *
 * Pagination follows cursors (`after`) through graphClient — never Meta's
 * `paging.next` URL, which embeds the access token.
 */

export type AdAccount = {
  id: string
  name: string
  currency: string | null
  /** IANA name, e.g. "Asia/Jerusalem" — Meta resolves date presets in this zone. */
  timezone: string | null
  status: number | null
}

export type AdsFailure = 'reconnect_required' | 'permission_missing' | 'rate_limited' | 'meta_error'

export type AdsResult<T> = { ok: true; value: T } | { ok: false; reason: AdsFailure }

const MAX_ACCOUNT_PAGES = 5
const INSIGHTS_PAGE_SIZE = 100

/**
 * Error → reason, per the Graph error-handling guide: 190 invalid token;
 * 10 and 200-299 permission errors; 4/17/32/613 throttling, plus the
 * 80000-80014 range the Marketing API uses for its business-use-case rate limits.
 */
export function adsFailureFromGraph(error: MetaGraphError): AdsFailure {
  if (error.kind !== 'graph') return 'meta_error'
  const code = error.code
  if (code === 190 || error.status === 401) return 'reconnect_required'
  if (code === 4 || code === 17 || code === 32 || code === 613 || (code !== null && code >= 80000 && code <= 80014)) {
    return 'rate_limited'
  }
  if (code === 10 || (code !== null && code >= 200 && code <= 299)) return 'permission_missing'
  return 'meta_error'
}

export function adsFail<T>(error: MetaGraphError, what: string): AdsResult<T> {
  const reason = adsFailureFromGraph(error)
  console.warn(`[AdsReporting] ${what} failed`, { reason, detail: describeGraphError(error) })
  return { ok: false, reason }
}

export async function listAdAccounts(token: string): Promise<AdsResult<AdAccount[]>> {
  const accounts: AdAccount[] = []
  let after: string | undefined
  for (let page = 0; page < MAX_ACCOUNT_PAGES; page++) {
    const result = await graphRequest<{ data?: Record<string, unknown>[]; paging?: { cursors?: { after?: string } } }>({
      path: '/me/adaccounts',
      token,
      query: { fields: 'id,name,currency,timezone_name,account_status', limit: 100, after },
    })
    if ('error' in result) return adsFail(result.error, 'list ad accounts')
    for (const a of result.data.data ?? []) {
      if (typeof a.id !== 'string' || !a.id.startsWith('act_')) continue
      accounts.push({
        id: a.id,
        name: typeof a.name === 'string' && a.name ? a.name : a.id,
        currency: typeof a.currency === 'string' ? a.currency : null,
        timezone: typeof a.timezone_name === 'string' && a.timezone_name ? a.timezone_name : null,
        status: toNumber(a.account_status),
      })
    }
    after = result.data.paging?.cursors?.after
    if (!after || (result.data.data ?? []).length === 0) break
  }
  return { ok: true, value: accounts }
}

export const isAdAccountId = (id: string) => /^act_\d+$/.test(id)
export const isAdObjectId = (id: string | undefined | null): id is string => typeof id === 'string' && /^\d{1,32}$/.test(id)

/**
 * GET /{act_id}/insights, following cursors up to `maxPages`. The path is always
 * the VERIFIED ad account, so a `filtering` value can only narrow inside it.
 */
export async function readInsights(
  token: string,
  accountId: string,
  query: Record<string, string | number | undefined>,
  opts: { maxPages?: number; what: string },
): Promise<AdsResult<Record<string, unknown>[]>> {
  if (!isAdAccountId(accountId)) return { ok: false, reason: 'permission_missing' }
  const rows: Record<string, unknown>[] = []
  let after: string | undefined
  for (let page = 0; page < (opts.maxPages ?? 1); page++) {
    const res = await graphRequest<{ data?: Record<string, unknown>[]; paging?: { cursors?: { after?: string } } }>({
      path: `/${accountId}/insights`,
      token,
      query: { limit: INSIGHTS_PAGE_SIZE, ...query, after },
      timeoutMs: 15000,
    })
    if ('error' in res) return adsFail(res.error, opts.what)
    const batch = res.data.data ?? []
    rows.push(...batch)
    after = res.data.paging?.cursors?.after
    if (!after || batch.length < INSIGHTS_PAGE_SIZE) break
  }
  return { ok: true, value: rows }
}

/**
 * Delivery status for objects Meta just returned in insights (ids never come from
 * the URL here). Multi-id lookup, 50 ids per call. A failure is not fatal: the
 * report still shows Meta's numbers, with the status unknown ("—").
 */
export async function readStatuses(token: string, ids: string[]): Promise<Map<string, string> | null> {
  const statuses = new Map<string, string>()
  const valid = [...new Set(ids.filter(isAdObjectId))]
  for (let i = 0; i < valid.length; i += 50) {
    const res = await graphRequest<Record<string, { effective_status?: unknown }>>({
      path: '/',
      token,
      query: { ids: valid.slice(i, i + 50).join(','), fields: 'effective_status' },
    })
    if ('error' in res) {
      adsFail(res.error, 'delivery status')
      return null
    }
    for (const [id, obj] of Object.entries(res.data ?? {})) {
      if (typeof obj?.effective_status === 'string') statuses.set(id, obj.effective_status)
    }
  }
  return statuses
}
