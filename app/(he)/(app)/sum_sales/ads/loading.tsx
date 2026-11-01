import AdsReportSkeleton from '@/modules/adsReporting/components/AdsReportSkeleton'

/**
 * First entry into ביצועי מודעות. Synchronous by design (see app/(app)/loading.tsx).
 * Next keys a page's state without its search params, so this boundary does not
 * reappear when dates or the account change — AdsReportShell handles those.
 */
export default function Loading() {
  return <AdsReportSkeleton />
}
