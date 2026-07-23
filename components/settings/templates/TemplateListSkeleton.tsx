/**
 * Content-shaped loading placeholder that mirrors the real `TemplateRow` layout
 * (title bar + preview bar + a pill), so the list "almost ready" instead of a
 * spinner. Decorative (aria-hidden); reduced-motion safe.
 */
export default function TemplateListSkeleton() {
  return (
    <div className='grid gap-2' aria-hidden='true' data-testid='templates-skeleton'>
      {[0, 1, 2].map((i) => (
        <div key={i} className='flex items-center justify-between gap-3 rounded-md border border-gray-200 p-3'>
          <div className='min-w-0 flex-1 space-y-2'>
            <div className='h-4 w-40 rounded bg-gray-100 motion-safe:animate-pulse' />
            <div className='h-3 w-64 max-w-full rounded bg-gray-100 motion-safe:animate-pulse' />
          </div>
          <div className='h-5 w-20 shrink-0 rounded-full bg-gray-100 motion-safe:animate-pulse' />
        </div>
      ))}
    </div>
  )
}
