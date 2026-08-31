/**
 * The one answer to "may this environment write to the Meta dataset?"
 *
 * WHY IT EXISTS. `.env` and `.env.local` both carry the SAME
 * `NEXT_PUBLIC_META_PIXEL_ID` as production, and nothing in the pixel path ever
 * consulted the environment — so `next dev` on a laptop, and every preview
 * deployment, wrote PageView straight into the production dataset ("Social CRM
 * Production"). Pollution of an ads dataset is not reversible from our side.
 *
 * FAILS CLOSED. Anything that is not demonstrably production is off. An unset
 * `NEXT_PUBLIC_VERCEL_ENV` — a laptop, a test runner, a self-hosted build —
 * yields false, so a new environment is silent until someone opts it in.
 *
 * THE ESCAPE HATCH. `NEXT_PUBLIC_META_TRACKING_ENABLED` overrides in BOTH
 * directions: '1' forces tracking on (needed if Vercel's system environment
 * variables are not exposed to the client bundle), '0' forces it off (a
 * production-like environment that must stay out of the dataset). Both are
 * `NEXT_PUBLIC_*` because the browser half of this gate is bundled at build
 * time and cannot read a server-only value.
 */
export function isMetaTrackingEnabled(): boolean {
  const explicit = process.env.NEXT_PUBLIC_META_TRACKING_ENABLED
  if (explicit === '1') return true
  if (explicit === '0') return false
  return process.env.NEXT_PUBLIC_VERCEL_ENV === 'production'
}
