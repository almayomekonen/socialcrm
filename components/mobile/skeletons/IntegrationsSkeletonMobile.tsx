import { Pulse, Status } from './Pulse'

/** Mirrors IntegrationsLanding: title + status cards with a 44px CTA. */
export default function IntegrationsSkeletonMobile() {
  return (
    <div className='px-4 pb-8 pt-4' aria-busy='true' data-testid='integrations-skeleton-mobile'>
      <Status>טוען…</Status>
      <Pulse className='h-7 w-36 rounded' />
      <Pulse className='mt-2 h-4 w-56 max-w-full rounded' />
      <Pulse className='mt-5 h-3.5 w-24 rounded' />
      <div className='mt-3 flex flex-col gap-3' aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className='rounded-xl border border-gray-200 bg-white p-4'>
            <div className='flex items-start gap-3'>
              <Pulse className='size-7 shrink-0 rounded-lg' />
              <div className='min-w-0 flex-1 space-y-2'>
                <Pulse className='h-4 w-28 rounded' />
                <Pulse className='h-3 w-full rounded' />
              </div>
            </div>
            <Pulse className='mt-4 h-11 w-full rounded-md' />
          </div>
        ))}
      </div>
    </div>
  )
}
