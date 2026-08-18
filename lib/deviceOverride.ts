/**
 * The development-only device override — the two constants and the two pure
 * predicates shared by `proxy.ts` and `lib/device.ts`.
 *
 * WHY THIS IS A SEPARATE FILE FROM `lib/device.ts`. `proxy.ts` runs in the Edge
 * middleware runtime, where importing `next/headers` is a build error. Every
 * other line of device logic lives in `lib/device.ts` (which does import
 * `next/headers`), so the handful of symbols the proxy needs are isolated here.
 * This file imports nothing and touches no request state — it is safe in the
 * Edge runtime, the Node runtime and vitest alike.
 *
 * WHAT THE OVERRIDE IS FOR. Chrome DevTools "Responsive mode" changes the
 * VIEWPORT, not the User-Agent. Because the entity split is decided server-side
 * from the UA (see `lib/device.ts` for why), narrowing the DevTools viewport
 * renders the desktop workspace at 390px — which is precisely the thing the
 * architecture forbids shipping, and therefore a useless way to inspect the
 * mobile workspace. `?device=phone` makes the local server classify the request
 * the way a real iPhone would, so DevTools becomes a real preview again.
 *
 * WHAT IT IS NOT. It is not authentication, not authorization, not a feature
 * flag, and not a rollout control. It changes exactly one thing — the answer to
 * "is this request a phone" — and only on a developer's machine. The session
 * gate, the agency gate, the onboarding gate, the trial gate and
 * `canEnterMobileWorkspace()` all still run, unchanged and in the same order.
 */

/** `?device=phone` / `?device=desktop`. */
export const DEVICE_OVERRIDE_PARAM = 'device'

/**
 * The request header the proxy stamps from the query param, so any Server
 * Component can read the override without every page having to thread
 * `searchParams` into `getDeviceClass()`.
 *
 * PROXY-OWNED. The proxy DELETES any inbound value before setting its own, so a
 * client cannot inject it — and `lib/device.ts` reads it only when
 * `isDeviceOverrideAllowed()` is true, so in production it is ignored even if
 * something upstream managed to set it. Two independent guards, either of which
 * is sufficient on its own.
 */
export const DEVICE_OVERRIDE_HEADER = 'x-device-class-override'

/**
 * LOCAL DEVELOPMENT ONLY.
 *
 * `NODE_ENV` is not application config: Next sets it (`next dev` ⇒
 * 'development', `next build` / `next start` ⇒ 'production', vitest ⇒ 'test')
 * and inlines it at build time. It is NOT settable from a Vercel environment
 * variable, so a production deployment cannot enter this branch however the env
 * is configured. There is deliberately no second flag and no allowlist entry —
 * either would be a knob that could be set wrongly somewhere real.
 */
export function isDeviceOverrideAllowed(): boolean {
  return process.env.NODE_ENV === 'development'
}

/** Strict vocabulary. Anything else — including 'tablet' or '1' — is no override at all. */
export function parseDeviceOverride(value: string | null | undefined): 'phone' | 'desktop' | null {
  return value === 'phone' || value === 'desktop' ? value : null
}

/**
 * Re-attach an active override to an internal destination URL.
 *
 * WHY THIS EXISTS. The override lives only in the URL, so any client navigation
 * that builds its own href drops it — `router.push(leadsHref(filters))` is the
 * measured case. When it drops mid-session the server renders the next page for
 * the REAL device while the already-mounted shell stays as it was, producing a
 * mobile shell around a desktop page. This keeps the selection attached instead.
 *
 * PURE AND SHARED. Both dev-only navigation paths call this one function, so
 * `<Link>` and `router.push`/`replace` cannot drift apart. It is a string
 * transform: no framework, no DOM, no clock — trivially unit-testable, which is
 * what lets every exclusion below be asserted rather than asserted-about.
 *
 * IT REWRITES ONLY WHAT IT OWNS. Anything that is not a same-origin,
 * path-absolute URL is returned untouched:
 *   · absolute/external (`https://…`)      — never leak the parameter off-site
 *   · protocol-relative (`//host/path`)    — starts with `/` but is ANOTHER origin
 *   · `mailto:` / `tel:` / `#fragment`     — not navigations we control
 *   · anything already carrying `device=`  — an explicit choice is never overwritten
 *
 * NOT A URL BUILDER. It takes a finished href and returns a finished href, so no
 * caller — and no business-code URL helper — needs to know a device override
 * exists.
 */
export function withDeviceOverride(url: string, device: 'phone' | 'desktop' | null | undefined): string {
  if (!device) return url
  if (typeof url !== 'string' || url.length === 0) return url

  // Path-absolute only. `//` is protocol-relative and therefore cross-origin.
  if (!url.startsWith('/') || url.startsWith('//')) return url

  const [pathAndQuery, ...hashParts] = url.split('#')
  const hash = hashParts.length ? '#' + hashParts.join('#') : ''
  const [path, ...queryParts] = pathAndQuery.split('?')
  const query = queryParts.join('?')

  const params = new URLSearchParams(query)
  if (params.has(DEVICE_OVERRIDE_PARAM)) return url

  params.set(DEVICE_OVERRIDE_PARAM, device)
  return `${path}?${params.toString()}${hash}`
}
