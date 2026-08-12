/**
 * Presentation-only SocialCRM workspace backdrop, shown BEHIND the activation
 * modal / expired paywall for blocked states (NEVER_STARTED / TRIAL_EXPIRED).
 *
 * SECURITY: this replaces the real interactive workspace + page `{children}` in
 * the layout for blocked states, so the server never renders or streams the real
 * CRM to a user without product access. It is pure static chrome — NO real
 * `{children}`, NO customer/lead data, NO server data fetch, NO live actions.
 * It is `inert` + `aria-hidden` + `pointer-events-none` and blurred/dimmed, so
 * even if the modal/blur is removed via DevTools, only a non-functional teaser
 * is exposed — never a usable CRM. Authorization is still enforced server-side
 * at the product boundaries (requireProductAccess); this is defense-in-depth +
 * the "SocialCRM visible behind the modal" presentation.
 *
 * Server Component, no client hooks — nothing to hydrate, nothing to interact.
 */
export default function WorkspaceTeaser() {
  const navIcons = Array.from({ length: 6 })
  const rows = Array.from({ length: 6 })
  return (
    <div
      aria-hidden='true'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {...({ inert: '' } as any)}
      className='flex-1 min-h-0 flex flex-col pointer-events-none select-none overflow-hidden opacity-70 blur-[2px]'
    >
      {/* Top bar — recognizable SocialCRM chrome */}
      <div className='h-10 shrink-0 flex items-center justify-between px-4 border-b bg-white/90'>
        <div className='flex items-center gap-2'>
          <img src='/media/fav.svg' alt='' className='h-6' />
          <span className='font-bold text-lg tracking-tight text-gray-800'>SocialCRM</span>
        </div>
        <div className='flex items-center gap-2'>
          <span className='size-6 rounded-full bg-gray-200' />
          <span className='h-3 w-24 rounded bg-gray-200' />
        </div>
      </div>

      {/* Body: slim sidebar + skeleton content */}
      {/*
        MOBILE SAFETY (presentation only — still aria-hidden, inert, no data).
        At 360px the previous fixed widths summed past the available track
        (sidebar 56 + padding 48 + row content ~400 in a ~256px column). The root
        `overflow-hidden` stopped the PAGE scrolling sideways, but the skeleton
        itself was cut mid-row, which reads as a broken screen behind the trial
        modal — the first thing a mobile user would ever see of SocialCRM.
        Narrower rail, fewer stat cards, and flexible row bars instead of fixed
        w-40/w-24/w-16.
      */}
      <div className='flex-1 min-h-0 flex'>
        <div className='w-14 shrink-0 border-e bg-white/80 flex flex-col items-center gap-4 pt-4 mobile:w-10 mobile:gap-3'>
          {navIcons.map((_, i) => (
            <span key={i} className='size-7 rounded-lg bg-gray-200 mobile:size-6' />
          ))}
        </div>

        <div className='flex-1 min-w-0 p-6 mobile:p-4'>
          <div className='flex items-center justify-between mb-6 gap-3 mobile:mb-4'>
            <span className='h-6 w-40 rounded bg-gray-200 mobile:h-5 mobile:w-24' />
            <span className='h-9 w-32 rounded-lg bg-gray-200 mobile:h-8 mobile:w-20' />
          </div>
          <div className='grid grid-cols-3 gap-4 mb-6 mobile:grid-cols-2 mobile:gap-3 mobile:mb-4'>
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                /* The third card would be a lone orphan on a 2-up mobile grid. */
                className={`h-20 rounded-lg border border-gray-200 bg-white/70 mobile:h-16 ${i === 2 ? 'mobile:hidden' : ''}`}
              />
            ))}
          </div>
          <div className='rounded-lg border border-gray-200 bg-white/70 divide-y divide-gray-100'>
            {rows.map((_, i) => (
              <div key={i} className='flex items-center gap-4 px-4 py-3 mobile:gap-2.5 mobile:px-3 mobile:py-2.5'>
                <span className='size-8 shrink-0 rounded-full bg-gray-200 mobile:size-7' />
                {/* Flexible instead of w-40: fills whatever the column allows. */}
                <span className='h-3 w-40 min-w-0 flex-1 rounded bg-gray-200 mobile:w-auto' />
                <span className='h-3 w-24 shrink-0 rounded bg-gray-200 ms-auto mobile:w-12' />
                <span className='h-3 w-16 shrink-0 rounded bg-gray-200 mobile:hidden' />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
