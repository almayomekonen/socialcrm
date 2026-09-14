import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getUser } from '@/db/auth'
import { getAdConnection } from '@/db/facebookAds'
import { isAdmin, type Roles } from '@/types/roles'
import { isFacebookAdsReportingEnabledForAgency } from '@/lib/facebook/permissions'
import { adsRangeLabel, parseAdsRange } from '@/lib/facebook/ads/dateRange'
import { businessDateString } from '@/lib/today/time'
import { getInAppBrowser, type InAppBrowser } from '@/lib/device'
import { getAdsReport, listAdAccounts, type AdsFailure } from '@/lib/facebook/ads/insights'
import ConnectionNotice from '@/components/settings/ConnectionNotice'
import MetaPermissionButton from '@/components/settings/MetaPermissionButton'
import { Btn } from '@/lib/btns/Btn'
import { ADS_NOTICES, type AdsNoticeKind } from '@/modules/adsReporting/notices'
import AdsReportControls from '@/modules/adsReporting/components/AdsReportControls'
import AdsReportView from '@/modules/adsReporting/components/AdsReportView'
import DisconnectAdsButton from '@/modules/adsReporting/components/DisconnectAdsButton'

/**
 * ביצועי מודעות — a tab inside ביצועים (no new top-level navigation).
 *
 * Read-only, through `ads_read`, for the CURRENT user's own ad connection.
 * Admin-only: ad spend is financial data. Every ad account id in the URL is
 * checked against the accounts Meta lists for this user's token before any
 * insights read. States never overlap, and "no activity" is never an error.
 */
export const metadata: Metadata = { title: 'ביצועי מודעות' }

type SearchParams = { account?: string; range?: string; since?: string; until?: string; ads_error?: string; connected?: string }

const FAILURE_NOTICE: Record<AdsFailure, AdsNoticeKind> = {
  reconnect_required: 'expired',
  permission_missing: 'permission',
  rate_limited: 'rate_limited',
  meta_error: 'meta_error',
}

function Notice({ kind, extra, inAppBrowser }: { kind: AdsNoticeKind; extra?: React.ReactNode; inAppBrowser?: InAppBrowser }) {
  const notice = ADS_NOTICES[kind]
  return (
    <div className='grid max-w-2xl gap-2'>
      <ConnectionNotice notice={notice} />
      {notice.cta === 'connect' && <MetaPermissionButton href='/api/auth/facebook/ads' lbl={notice.action!} inAppBrowser={inAppBrowser} />}
      {notice.cta === 'retry' && <Btn lbl={notice.action!} variant='outline' size='small' className='w-fit' href='/sum_sales/ads' />}
      {extra}
    </div>
  )
}

export default async function AdsReportingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
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

  const sp = await searchParams
  const inAppBrowser = await getInAppBrowser()
  let connection: Awaited<ReturnType<typeof getAdConnection>> = null
  try {
    connection = await getAdConnection(user.agencyId, user.id)
  } catch {
    return page(<Notice inAppBrowser={inAppBrowser} kind='expired' />)
  }

  if (!connection) return page(<Notice inAppBrowser={inAppBrowser} kind={sp.ads_error === 'declined' ? 'declined' : 'connect'} />)
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

  const controls = (
    <div className='flex flex-wrap items-end justify-between gap-3'>
      <AdsReportControls accounts={accounts.value.map(({ id, name }) => ({ id, name }))} accountId={account.id} range={range} today={today} />
      {disconnect}
    </div>
  )

  const report = await getAdsReport(connection.token, account.id, range)
  const body =
    'reason' in report ? (
      <Notice inAppBrowser={inAppBrowser} kind={FAILURE_NOTICE[report.reason]} />
    ) : report.value.totals === null ? (
      // Meta returned no rows for the account in this range: no spend, no delivery.
      <Notice inAppBrowser={inAppBrowser} kind='no_activity' />
    ) : (
      <AdsReportView report={report.value} currency={account.currency} rangeLabel={adsRangeLabel(range)} />
    )

  return page(
    <>
      {controls}
      {invalid && <ConnectionNotice notice={ADS_NOTICES.invalid_range} />}
      {body}
    </>,
  )
}
