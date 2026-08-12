'use client'

import Icon from '@/lib/Icon'

/**
 * Call, from a list row.
 *
 * A plain `tel:` anchor rather than a button with an onClick handler: on a phone
 * `tel:` is a real navigation the OS owns, so an anchor gets long-press, "add to
 * contacts", and copy for free — all of which an onClick would swallow. It also
 * keeps the control operable if hydration is slow, which matters on the exact
 * networks phones are on.
 *
 * `stopPropagation` because this sits inside a `MobileListRow` whose whole
 * surface navigates to the lead. Without it, tapping Call would both dial AND
 * navigate. (It is rendered in the row's `trailing` slot, which is outside the
 * row's own link/button element — never nested inside it.)
 */
export default function MobileLeadCallButton({ phone, name }: { phone?: string | null; name?: string | null }) {
  if (!phone) return null
  return (
    <a
      href={`tel:${phone}`}
      onClick={(e) => e.stopPropagation()}
      // The accessible name must say WHO is being called — "התקשר" repeated down
      // a list of eight rows tells a screen-reader user nothing.
      aria-label={name ? `התקשר ל${name}` : 'התקשר'}
      className='flex size-11 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
    >
      <Icon name='phone' type='sol' className='size-4 bg-gray-700' />
    </a>
  )
}
