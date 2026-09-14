import { headers } from 'next/headers'
import { userAgent } from 'next/server'
import { canEnterMobileWorkspace } from '@/lib/flags/mobileFlags'
import { DEVICE_OVERRIDE_HEADER, isDeviceOverrideAllowed, parseDeviceOverride } from '@/lib/deviceOverride'

/**
 * WHICH APPLICATION ENTITY IS THIS REQUEST — the single authoritative answer.
 *
 * SocialCRM ships two entities, not one responsive app:
 *
 *   Phone request   → Phone shell   (MobileWorkspaceShell) → phone presentation
 *   Desktop request → Desktop shell (Topbar + WorkspaceGrid) → desktop presentation
 *
 * They are chosen ONCE, on the SERVER, from this function. A desktop browser
 * must never receive mobile chrome in its HTML and a phone must never receive a
 * desktop table — not for a frame, not behind a media query, not hidden by CSS
 * (architecture-rules.md §9: prevention by absence, never suppression after the
 * fact). Everything downstream — the layout's shell choice and every route's
 * presentation choice — is a consumer of this one classification, which is what
 * makes "shell says phone, page says desktop" structurally impossible.
 *
 * VIEWPORT IS NOT DEVICE, DELIBERATELY. Nothing here reads `window.innerWidth`,
 * `matchMedia`, or `navigator.userAgent`, and no Client Component may either:
 * a client-side answer arrives after the HTML is already on the wire, which is
 * exactly how you get a desktop grid painting for a frame inside a mobile shell.
 * The funnel audit traced a real production defect to two surfaces answering
 * "is this mobile?" by different rules (viewport vs. User-Agent); one
 * server-side definition is the fix.
 */

export type DeviceClass = 'phone' | 'desktop'

/**
 * TABLETS ARE DESKTOP. Stated explicitly because it is a product decision, not
 * an oversight, and because `device.type` offers a third value we are choosing
 * to fold in.
 *
 * `userAgent()` reports 'mobile' for phones, 'tablet' for tablets and undefined
 * for desktop. A tablet is classified DESKTOP because it has the screen the
 * desktop workspace was designed for — an iPad in landscape is ~1080px wide,
 * wider than many laptops — and the mobile workspace is a deliberately reduced
 * five-tab surface. Sending a tablet to the phone entity would REMOVE capability
 * from a device that can display all of it. This also matches the historical
 * >=1000px behaviour as closely as a UA-based server decision can.
 *
 * Pure and headers-shaped rather than request-bound, so the classification can
 * be asserted against real User-Agent strings without a live request.
 */
export function deviceClassFromHeaders(h: Headers): DeviceClass {
  const { device } = userAgent({ headers: h })
  return device.type === 'mobile' ? 'phone' : 'desktop'
}

/**
 * IS THIS REQUEST INSIDE INSTAGRAM'S OR FACEBOOK'S IN-APP BROWSER?
 *
 * A separate question from device class, with a separate consequence: an in-app
 * browser is a phone, but one where Meta's own login dialog does not reliably
 * complete. Production agency 149 signed up from an Instagram bio link and
 * started seven Meta connections in sixteen minutes; not one returned to a
 * callback, success or failure. Knowing this BEFORE opening the dialog is the
 * only way to say something useful instead of nothing.
 *
 * Server-side for the same reason as `deviceClassFromHeaders`: no Client
 * Component reads `navigator.userAgent`. Render sites pass the answer down as a
 * prop. Messenger's in-app browser reports as 'facebook' (FBAN/FBAV/FB_IAB).
 */
export type InAppBrowser = 'instagram' | 'facebook' | null

export function inAppBrowserFromHeaders(h: Headers | null | undefined): InAppBrowser {
  // Tolerates a missing Headers object: callers use this for analytics on the
  // way to Meta, and a detection hiccup must never cost the redirect.
  const ua = h?.get('user-agent') ?? ''
  if (/\bInstagram\b/.test(ua)) return 'instagram'
  if (/\b(FBAN|FBAV|FB_IAB)\//.test(ua)) return 'facebook'
  return null
}

export async function getInAppBrowser(): Promise<InAppBrowser> {
  return inAppBrowserFromHeaders(await headers())
}

/**
 * The one call every server surface makes.
 *
 * Order is load-bearing: the development override is consulted FIRST so
 * `?device=phone` wins over the real User-Agent on a developer's machine, and
 * `isDeviceOverrideAllowed()` is false everywhere else, so production and every
 * preview deployment reach the User-Agent classification unconditionally. See
 * `lib/deviceOverride.ts` for why that guard cannot be flipped by configuration.
 */
export async function getDeviceClass(): Promise<DeviceClass> {
  const h = await headers()

  const override = await getActiveDeviceOverride()
  if (override) return override

  return deviceClassFromHeaders(h)
}

/**
 * The override in force on THIS request, or null — which in production is
 * always null, because `isDeviceOverrideAllowed()` is false there.
 *
 * Exists so the layout can ask "is a developer currently forcing an entity?"
 * without re-deriving the guard. Its one consumer mounts the dev-only link
 * preserver (see `components/dev/DeviceOverrideLinks.tsx`), so a production
 * render receives null and mounts nothing at all.
 */
export async function getActiveDeviceOverride(): Promise<DeviceClass | null> {
  if (!isDeviceOverrideAllowed()) return null
  return parseDeviceOverride((await headers()).get(DEVICE_OVERRIDE_HEADER))
}

/**
 * Kept as the historical name for the ~8 call sites that already ask this
 * question, now a one-line derivation of `getDeviceClass()` rather than a second
 * User-Agent parser. Preserving it is the point: every existing caller — the
 * (app) layout, /activate, Today, לידים, שיחות, lead detail, the settings
 * layout, /m — is routed through the single authority without being edited, and
 * each one gains the development override for free.
 */
export async function isMobileRequest(): Promise<boolean> {
  return (await getDeviceClass()) === 'phone'
}

/**
 * "Is this request the MOBILE WORKSPACE?" — device class AND rollout gate, as
 * one named concept.
 *
 * These two questions were always asked together and never apart:
 * `(await isMobileRequest()) && canEnterMobileWorkspace(user.agencyId)` appears
 * verbatim at every branch point in the app. Naming the pair means a new mobile
 * surface cannot accidentally check one half — the failure mode that leaves a
 * phone inside the mobile shell looking at a desktop page.
 *
 * The rollout gate is untouched and still decides who may enter:
 * `MOBILE_WORKSPACE_ENABLED=1` AND the agency in
 * `MOBILE_WORKSPACE_AGENCY_ALLOWLIST` (production: 103 and 23 only), with the
 * local-development bypass documented in `lib/flags/mobileFlags.ts`. The device
 * override changes the DEVICE answer only — it can never admit an agency the
 * allowlist excludes.
 */
export async function isMobileWorkspaceRequest(agencyId: number | null | undefined): Promise<boolean> {
  return (await getDeviceClass()) === 'phone' && canEnterMobileWorkspace(agencyId)
}
