import { Pulse, Status } from './Pulse'

/** Mirrors LeadDetailMobile: identity, info card, sticky contact bar. */
export default function LeadDetailSkeletonMobile() {
  return (
    <div className='flex min-h-full flex-col' aria-busy='true' data-testid='lead-detail-skeleton-mobile'>
      <Status>טוען…</Status>
      <div className='flex-1 px-4 pb-4 pt-4' aria-hidden>
        <Pulse className='h-7 w-40 rounded' />
        <Pulse className='mt-1.5 h-3.5 w-24 rounded' />
        <div className='mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white'>
          {[0, 1, 2].map((i) => (
            <div key={i} className='flex justify-between border-b border-gray-100 px-3.5 py-3 last:border-b-0'>
              <Pulse className='h-3.5 w-16 rounded' />
              <Pulse className='h-3.5 w-28 rounded' />
            </div>
          ))}
        </div>
        <div className='mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white p-4'>
          <Pulse className='h-4 w-32 rounded' />
          <Pulse className='mt-3 h-3 w-full rounded' />
          <Pulse className='mt-2 h-3 w-2/3 rounded' />
        </div>
      </div>
      <div className='flex gap-2 border-t border-gray-200 bg-white px-3 py-2' aria-hidden>
        <Pulse className='h-11 min-w-0 flex-1 rounded-md' />
        <Pulse className='h-11 min-w-0 flex-1 rounded-md' />
      </div>
    </div>
  )
}
