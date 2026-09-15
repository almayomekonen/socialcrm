import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getUser } from '@/db/auth'
import { getAdConnection } from '@/db/facebookAds'
import { isAdmin, type Roles } from '@/types/roles'
import { isFacebookAdsReportingEnabledForAgency } from '@/lib/facebook/permissions'
import { adsRangeLabel, parseAdsRange } from '@/lib/facebook/ads/dateRange'
import { businessDateString } from '@/lib/today/time'
import { getInAppBrowser, type InAppBrowser } from '@/lib/device'
import { isAdObjectId, listAdAccounts } from '@/lib/facebook/ads/insights'
import { getAdsReport } from '@/lib/facebook/ads/report'
import { getAdsBreakdown } from '@/lib/facebook/ads/breakdown'
import type { AdsSelectionQuery } from '@/lib/facebook/ads/selection'
import ConnectionNotice from '@/components/settings/ConnectionNotice'
import MetaPermissionButton from '@/components/settings/MetaPermissionButton'
import { ADS_NOTICES, FAILURE_NOTICE, noConnectionNotice, type AdsNoticeKind } from '@/modules/adsReporting/notices'
import AdsReportShell from '@/modules/adsReporting/components/AdsReportShell'
import AdsReportControls from '@/modules/adsReporting/components/AdsReportControls'
import AdsReportView from '@/modules/adsReporting/components/AdsReportView'
import AdsRetryButton from '@/modules/adsReporting/components/AdsRetryButton'
import DisconnectAdsButton from '@/modules/adsReporting/components/DisconnectAdsButton'

/**
 * ביצועי מודעות — a tab inside ביצועים (no new top-level navigation).
 *
 * Read-only, through `ads_read`, for the CURRENT user's own ad connection.
 * Admin-only: ad spend is financial data. Every ad account id in the URL is
 * checked against the accounts Meta lists for this user's token before any
 * insights read, and drill-down ids are only ever read inside that account.
 * States never overlap, and "no activity" is never an error.
 *
 * LOADING: first entry shows loading.tsx; later changes keep this report on screen
 * inside AdsReportShell ("מעדכן נתונים…"), which also guards against stale responses.
 */
export const metadata: Metadata = { title: 'ביצועי מודעות' }
// Several sequential Meta reads per render (report + drill-down), like other external-call routes.
export const maxDuration = 60

type RawSearchParams = Record<string, string | string[] | undefined>
/** A repeated parameter (`?range=a&range=b`) arrives as an array; only a single string is a value. */
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined)

/** Today's calendar day in the ad account's timezone (Meta's days), or null for an unknown zone. */
function todayIn(timeZone: string | null): string | null {
  if (!timeZone) return null
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  } catch {
    return null
  }
}

function Notice({ kind, extra, inAppBrowser }: { kind: AdsNoticeKind; extra?: React.ReactNode; inAppBrowser?: InAppBrowser }) {
  const notice = ADS_NOTICES[kind]
  return (
    <div className='grid max-w-2xl gap-2'>
      <ConnectionNotice notice={notice} />
      {notice.cta === 'connect' && <MetaPermissionButton href='/api/auth/facebook/ads' lbl={notice.action!} inAppBrowser={inAppBrowser} />}
      {notice.cta === 'retry' && <AdsRetryButton lbl={notice.action} />}
      {extra}
    </div>
  )
}

export default async function AdsReportingPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await getUser()
  if (!user?.agencyId) redirect('/auth')
  if (!isFacebookAdsReportingEnabledForAgency(user.agencyId)) redirect('/sum_sales')

  const page = (body: React.ReactNode) => (
    <div className='grid gap-4 py-6'>
      <h1 className='title'>ביצועי מודעות</h1>
      {body}
    </div>
  )

  if (!isAdmin(user.role as Roles)) {
    return page(<p className='text-sm text-gray-600'>ביצועי המודעות זמינים למנהלי החשבון בלבד.</p>)
  }

  const raw = await searchParams
  const sp = {
    account: one(raw.account),
    range: one(raw.range),
    since: one(raw.since),
    until: one(raw.until),
    // A drill-down id Meta could never accept is ignored, not reported as a permission problem.
    campaign: isAdObjectId(one(raw.campaign)) ? one(raw.campaign) : undefined,
    adset: isAdObjectId(one(raw.adset)) ? one(raw.adset) : undefined,
    ads_error: one(raw.ads_error),
  }
  const inAppBrowser = await getInAppBrowser()
  let connection: Awaited<ReturnType<typeof getAdConnection>> = null
  try {
    connection = await getAdConnection(user.agencyId, user.id)
  } catch {
    return page(<Notice inAppBrowser={inAppBrowser} kind='expired' />)
  }

  if (!connection) return page(<Notice inAppBrowser={inAppBrowser} kind={noConnectionNotice(sp.ads_error)} />)
  if (!connection.grantedScopes.includes('ads_read')) return page(<Notice inAppBrowser={inAppBrowser} kind='declined' />)
  if (connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() <= Date.now()) return page(<Notice inAppBrowser={inAppBrowser} kind='expired' />)

  const disconnect = <DisconnectAdsButton />
  const accounts = await listAdAccounts(connection.token)
  if ('reason' in accounts) return page(<Notice inAppBrowser={inAppBrowser} kind={FAILURE_NOTICE[accounts.reason]} extra={disconnect} />)
  if (accounts.value.length === 0) return page(<Notice inAppBrowser={inAppBrowser} kind='no_accounts' extra={disconnect} />)

  // Only an account Meta listed for THIS token can be read; anything else falls back to the first.
  const account = accounts.value.find((a) => a.id === sp.account) ?? accounts.value[0]
  // The business's calendar day (Asia/Jerusalem), computed once on the server.
  const today = businessDateString(Date.now())
  const { range, invalid } = parseAdsRange(sp, today)

  const [report, breakdown] = await Promise.all([
    getAdsReport(connection.token, account.id, range, { today: todayIn(account.timezone) ?? today }),
    sp.campaign ? getAdsBreakdown(connection.token, account.id, range, { campaignId: sp.campaign, adsetId: sp.adset }) : null,
  ])

  const body =
    'reason' in report ? (
      <Notice inAppBrowser={inAppBrowser} kind={FAILURE_NOTICE[report.reason]} />
    ) : report.value.totals === null ? (
      // Meta returned no rows for the account in this range: no delivery IN THIS RANGE.
      <Notice inAppBrowser={inAppBrowser} kind='no_activity' />
    ) : (
      <AdsReportView
        report={{ ...report.value, totals: report.value.totals }}
        breakdown={breakdown}
        account={{ name: account.name, currency: account.currency, timezone: account.timezone }}
      />
    )

  const rendered: AdsSelectionQuery = { account: sp.account, range: sp.range, since: sp.since, until: sp.until, campaign: sp.campaign, adset: sp.adset }

  return page(
    <AdsReportShell
      rendered={rendered}
      renderedLabel={`${account.name} · ${adsRangeLabel(range)}`}
      controls={
        <div className='flex flex-wrap items-end justify-between gap-3'>
          <AdsReportControls accounts={accounts.value.map(({ id, name }) => ({ id, name }))} accountId={account.id} today={today} />
          {disconnect}
        </div>
      }
    >
      {invalid && <ConnectionNotice notice={ADS_NOTICES.invalid_range} />}
      {body}
    </AdsReportShell>,
  )
}
