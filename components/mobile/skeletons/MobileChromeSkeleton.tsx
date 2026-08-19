import MobileInnerSkeleton from './MobileInnerSkeleton'

/**
 * First paint while `(app)/layout` LayoutContent is still resolving.
 *
 * Observed: a phone hitting /inbox (and other cold routes) received the desktop
 * full-screen spinner (`components/ui/Loading`, size-32) because layout wraps
 * itself in `<Suspense fallback={<Loading />}>`. This chrome matches
 * MobileWorkspaceShell so the tab bar and header are already the product, not
 * a blank disc.
 *
 * Inert placeholders — not the live tab bar — so a tap during this brief
 * window cannot navigate a half-booted shell.
 *
 * Inner content follows `path` when the request exposes one, so a cold `/leads`
 * does not paint a Today-shaped body inside the chrome.
 */
export default function MobileChromeSkeleton({ path = '' }: { path?: string }) {
  return (
    <div data-mobile-workspace className='flex h-dvh flex-col bg-bg' aria-busy='true' data-testid='mobile-chrome-skeleton'>
      <div className='shrink-0 border-b border-gray-200 bg-white pt-[env(safe-area-inset-top,0px)]' aria-hidden>
        <div className='flex min-h-14 items-center px-3'>
          <div className='h-4 w-16 rounded bg-gray-100 motion-safe:animate-pulse' />
        </div>
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <MobileInnerSkeleton path={path} />
      </div>
      <div
        className='shrink-0 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom,0px)]'
        aria-hidden
      >
        <div className='flex h-14 items-stretch justify-around'>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className='flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-1'>
              <div className='size-5 rounded bg-gray-100 motion-safe:animate-pulse' />
              <div className='h-2 w-8 rounded bg-gray-100 motion-safe:animate-pulse' />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
