import { headers } from 'next/headers'
import { userAgent } from 'next/server'

/**
 * ARCHITECTURAL RULE — server-side gate for mobile-only UI.
 *
 * Mobile-only components (full-screen activation / "use a computer" overlays)
 * must NEVER be rendered into desktop HTML. Hiding them with CSS
 * (`desktop:hidden`, media queries, `hidden`, opacity, visibility, animations,
 * hydration timing) lets a fixed z-9999 overlay paint for a frame on desktop
 * before the browser applies the hide — a flash. Instead, gate the render at
 * the source: a server component calls this and returns `null` for non
 * mobile/tablet requests, so the overlay is absent from the DOM by construction.
 *
 * Phones AND tablets keep the mobile experience (this mirrors the `<1000px`
 * `desktop:hidden` breakpoint); only genuine desktop UAs (device.type is
 * `undefined`) are blocked. Never gate mobile-only UI with CSS alone.
 */
export async function isMobileOrTabletRequest(): Promise<boolean> {
  const { device } = userAgent({ headers: await headers() })
  return device.type === 'mobile' || device.type === 'tablet'
}
