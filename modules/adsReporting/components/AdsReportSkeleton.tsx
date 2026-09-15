/**
 * First-load shape of ביצועי מודעות: title, the two selectors, the status line,
 * the summary boxes and the campaign table — so the page does not jump when
 * Meta's numbers arrive. Same conventions as LeadsTableSkeleton: aria-busy root,
 * one screen-reader "טוען…" status, decorative blocks hidden from assistive tech,
 * pulse only when the user allows motion.
 *
 * Used only for the FIRST entry (loading.tsx). Changing dates or the account keeps
 * the previous report on screen with "מעדכן נתונים…" (AdsReportShell) instead.
 */
const block = 'rounded bg-gray-100 motion-safe:animate-pulse'

export default function AdsReportSkeleton() {
  return (
    <div className='grid gap-4 py-6' dir='rtl' aria-busy='true' data-testid='ads-report-skeleton'>
      <span className='sr-only' role='status'>
        טוען…
      </span>
      <div aria-hidden='true' className='grid gap-4'>
        <div className={`h-7 w-40 ${block}`} />
        <div className='flex flex-wrap items-end gap-3'>
          <div className='grid w-64 max-w-full gap-1.5'>
            <div className={`h-3.5 w-20 ${block}`} />
            <div className='h-10 rounded-md border border-gray-200 bg-gray-50' />
          </div>
          <div className='grid w-48 max-w-full gap-1.5'>
            <div className={`h-3.5 w-20 ${block}`} />
            <div className='h-10 rounded-md border border-gray-200 bg-gray-50' />
          </div>
        </div>
        <div className={`h-4 w-72 ${block}`} />
        <div className='flex flex-wrap gap-4'>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className='num-box grid gap-3 px-6 py-6'>
              <div className={`h-3.5 w-20 ${block}`} />
              <div className={`h-8 w-28 ${block}`} />
            </div>
          ))}
        </div>
        <div className='rounded-lg border border-gray-200 bg-white'>
          <div className='border-b border-gray-100 px-4 py-3'>
            <div className={`h-4 w-36 ${block}`} />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className='flex gap-4 border-b border-gray-100 px-4 py-3 last:border-b-0'>
              <div className={`h-3.5 w-48 ${block}`} />
              <div className={`h-3.5 w-16 ${block}`} />
              <div className={`h-3.5 w-16 ${block}`} />
              <div className={`h-3.5 w-16 ${block}`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
