import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getUser } from '@/db/auth'
import { getAdConnection } from '@/db/facebookAds'
import { isAdmin, type Roles } from '@/types/roles'
import { isFacebookAdsReportingEnabledForAgency } from '@/lib/facebook/permissions'
import { adsRangeLabel, parseAdsRange } from '@/lib/facebook/ads/dateRange'
import { businessDateString } from '@/lib/today/time'
import { getInAppBrowser, type InAppBrowser } from '@/lib/device'
import { isAdObjectId, listAdAccounts, type AdAccount, type AdsResult } from '@/lib/facebook/ads/insights'
import { getAdsReport, type AdsReport } from '@/lib/facebook/ads/report'
import { getAdsBreakdown, type AdsBreakdown } from '@/lib/facebook/ads/breakdown'
import { rangeDays, rangeKey } from '@/lib/facebook/ads/dateRange'
import { cachedAdsRead, reportTtlMs } from '@/lib/facebook/ads/cached'
import { loadAdsIntelligence, loadCrmOnlyCampaigns } from '@/lib/facebook/ads/intelligence'
import { setSelectedAdAccount } from '@/db/facebookAds'
import { readSnapshot, writeSnapshot } from '@/db/adsSnapshots'
import AdsCrmOnlySection from '@/modules/adsReporting/components/AdsCrmOnlySection'
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
    <div className='grid grid-cols-[minmax(0,1fr)] gap-4 py-6'>
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
  const agencyId: number = user.agencyId
  // The business's calendar day (Asia/Jerusalem), computed once on the server.
  const today = businessDateString(Date.now())
  const { range, invalid } = parseAdsRange(sp, today)

  // Without a usable ad connection, SocialCRM still shows what it truthfully
  // knows: Lead Ads leads per campaign, from the ids Meta put on each lead.
  const withCrmOnly = async (notice: React.ReactNode) => {
    const period = rangeDays(range, today)
    const groups = await loadCrmOnlyCampaigns(agencyId, period)
    return page(
      <>
        {notice}
        <AdsCrmOnlySection groups={groups} period={period} />
      </>,
    )
  }

  let connection: Awaited<ReturnType<typeof getAdConnection>> = null
  try {
    connection = await getAdConnection(agencyId, user.id)
  } catch {
    return withCrmOnly(<Notice inAppBrowser={inAppBrowser} kind='expired' />)
  }

  if (!connection) return withCrmOnly(<Notice inAppBrowser={inAppBrowser} kind={noConnectionNotice(sp.ads_error)} />)
  if (!connection.grantedScopes.includes('ads_read')) return withCrmOnly(<Notice inAppBrowser={inAppBrowser} kind='declined' />)
  if (connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() <= Date.now()) {
    return withCrmOnly(<Notice inAppBrowser={inAppBrowser} kind='expired' />)
  }

  const disconnect = <DisconnectAdsButton />
  const listed = await listAdAccounts(connection.token)
  let accounts: AdAccount[]
  let accountsFromCache = false
  if ('reason' in listed) {
    // A transient Meta failure may fall back to THIS connection's remembered,
    // previously verified account; an auth/permission failure never does.
    const transient = listed.reason === 'rate_limited' || listed.reason === 'meta_error'
    const remembered =
      transient && connection.selectedAccountId
        ? await readSnapshot<AdAccount>({ agencyId, accountId: connection.selectedAccountId, kind: 'account' }, 'meta').catch(() => null)
        : null
    if (!remembered) return page(<Notice inAppBrowser={inAppBrowser} kind={FAILURE_NOTICE[listed.reason]} extra={disconnect} />)
    accounts = [remembered.payload]
    accountsFromCache = true
  } else {
    accounts = listed.value
  }
  if (accounts.length === 0) return withCrmOnly(<Notice inAppBrowser={inAppBrowser} kind='no_accounts' extra={disconnect} />)

  // Only an account Meta listed for THIS token can be read: the URL's choice, else
  // the remembered one, else the first. Ids from anywhere else are never used.
  const account =
    accounts.find((a) => a.id === sp.account) ?? accounts.find((a) => a.id === connection.selectedAccountId) ?? accounts[0]
  if (!accountsFromCache) {
    if (account.id !== connection.selectedAccountId) await setSelectedAdAccount(agencyId, user.id, account.id).catch(() => {})
    await writeSnapshot({ agencyId, accountId: account.id, kind: 'account' }, 'meta', account).catch(() => {})
  }

  const rk = rangeKey(range, today)
  const scope = { agencyId, accountId: account.id }
  const [reportRead, breakdownRead] = await Promise.all([
    cachedAdsRead({ ...scope, kind: 'report' }, rk, reportTtlMs(rk), () =>
      getAdsReport(connection.token, account.id, range, { today: todayIn(account.timezone) ?? today }),
    ),
    sp.campaign
      ? cachedAdsRead({ ...scope, kind: 'breakdown' }, `${rk}|${sp.campaign}|${sp.adset ?? ''}`, reportTtlMs(rk), () =>
          getAdsBreakdown(connection.token, account.id, range, { campaignId: sp.campaign!, adsetId: sp.adset }),
        )
      : null,
  ])
  const report: AdsResult<AdsReport> = 'value' in reportRead ? { ok: true, value: reportRead.value.value } : reportRead
  const breakdown: AdsResult<AdsBreakdown> | null =
    breakdownRead === null ? null : 'value' in breakdownRead ? { ok: true, value: breakdownRead.value.value } : breakdownRead
  const intel =
    'value' in report && report.value.totals
      ? await loadAdsIntelligence({
          agencyId,
          accountId: account.id,
          token: connection.token,
          range,
          rangeKey: rk,
          report: report.value,
          breakdown: breakdown && 'value' in breakdown ? breakdown.value : null,
          timezone: account.timezone,
          currency: account.currency,
          freshness: 'value' in reportRead ? { fetchedAt: reportRead.value.fetchedAt, stale: reportRead.value.stale } : null,
        })
      : null

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
        intel={intel}
      />
    )

  const rendered: AdsSelectionQuery = { account: sp.account, range: sp.range, since: sp.since, until: sp.until, campaign: sp.campaign, adset: sp.adset }

  return page(
    <AdsReportShell
      rendered={rendered}
      renderedLabel={`${account.name} · ${adsRangeLabel(range)}`}
      controls={
        <div className='flex flex-wrap items-end justify-between gap-3'>
          <AdsReportControls accounts={accounts.map(({ id, name }) => ({ id, name }))} accountId={account.id} today={today} />
          {disconnect}
        </div>
      }
    >
      {invalid && <ConnectionNotice notice={ADS_NOTICES.invalid_range} />}
      {body}
    </AdsReportShell>,
  )
}
