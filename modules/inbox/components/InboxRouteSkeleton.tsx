/**
 * Presentational 3-pane loading chrome for /inbox.
 * Used only by route `loading.tsx` — never mixed into hydrated inbox store state.
 */
export default function InboxRouteSkeleton() {
  return (
    <div
      className='flex h-[calc(100dvh-6rem)] min-h-0 gap-3'
      dir='rtl'
      aria-busy='true'
      data-testid='inbox-route-skeleton'
    >
      <span className='sr-only' role='status'>
        טוען…
      </span>

      <aside
        className='flex w-80 shrink-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white'
        aria-hidden='true'
      >
        <div className='border-b border-gray-100 p-3 space-y-2'>
          <div className='h-8 w-full rounded-md bg-gray-100' />
          <div className='flex gap-2'>
            <div className='h-6 w-16 rounded-full bg-gray-100' />
            <div className='h-6 w-16 rounded-full bg-gray-100' />
            <div className='h-6 w-14 rounded-full bg-gray-100' />
          </div>
        </div>
        <div className='min-h-0 flex-1 overflow-hidden'>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className='flex items-center gap-3 border-b border-gray-50 px-3 py-3'>
              <div className='size-9 shrink-0 rounded-full bg-gray-100' />
              <div className='min-w-0 flex-1 space-y-2'>
                <div className='h-3 w-2/3 rounded bg-gray-100' />
                <div className='h-2.5 w-full rounded bg-gray-50' />
              </div>
            </div>
          ))}
        </div>
      </aside>

      <section
        className='flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white'
        aria-hidden='true'
      >
        <div className='flex items-center gap-3 border-b border-gray-100 px-4 py-3'>
          <div className='size-8 rounded-full bg-gray-100' />
          <div className='h-3 w-40 rounded bg-gray-100' />
        </div>
        <div className='min-h-0 flex-1 space-y-3 p-4'>
          <div className='ms-auto h-10 w-2/5 rounded-2xl bg-gray-50' />
          <div className='h-10 w-1/2 rounded-2xl bg-gray-100' />
          <div className='ms-auto h-10 w-1/3 rounded-2xl bg-gray-50' />
          <div className='h-10 w-2/5 rounded-2xl bg-gray-100' />
        </div>
        <div className='border-t border-gray-100 p-3'>
          <div className='h-11 w-full rounded-md bg-gray-50' />
        </div>
      </section>

      <aside className='hidden w-80 shrink-0 overflow-hidden xl:block' aria-hidden='true'>
        <div className='mb-8 rounded-lg border border-gray-200 bg-white p-5' style={{ minHeight: 200 }}>
          <div className='mb-4 h-3 w-24 rounded bg-gray-100' />
          <div className='mb-2 h-3 w-3/4 rounded bg-gray-100' />
          <div className='mb-5 h-3 w-2/3 rounded bg-gray-100' />
          <div className='h-3 w-1/2 rounded bg-gray-100' />
        </div>
      </aside>
    </div>
  )
}
