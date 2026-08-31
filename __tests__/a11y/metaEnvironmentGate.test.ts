// @vitest-environment jsdom
//
// The environment gate on Meta tracking.
//
// THE DEFECT. `.env` and `.env.local` both carry the SAME
// `NEXT_PUBLIC_META_PIXEL_ID` as production, and nothing in the pixel path
// consulted the environment — so `next dev` on a laptop, and every preview
// deployment, wrote PageView straight into the production Meta dataset. An ads
// dataset cannot be un-polluted from our side, which is why the gate fails
// closed: anything not demonstrably production is off.
//
// The load-bearing assertions are the negative ones. A gate that lets preview
// through, or that treats an unset environment as production, is the bug.
//
// No DB: `npm run test:a11y` (VITEST_NO_DB=1).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isMetaTrackingEnabled } from '@/lib/facebook/pixelEnv'

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isMetaTrackingEnabled — truth table', () => {
  it("explicit '1' enables tracking", () => {
    vi.stubEnv('NEXT_PUBLIC_META_TRACKING_ENABLED', '1')
    expect(isMetaTrackingEnabled()).toBe(true)
  })

  it("explicit '0' disables tracking", () => {
    vi.stubEnv('NEXT_PUBLIC_META_TRACKING_ENABLED', '0')
    expect(isMetaTrackingEnabled()).toBe(false)
  })

  it("VERCEL_ENV 'production' enables tracking", () => {
    vi.stubEnv('NEXT_PUBLIC_META_TRACKING_ENABLED', '')
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production')
    expect(isMetaTrackingEnabled()).toBe(true)
  })

  it("VERCEL_ENV 'preview' does NOT enable tracking", () => {
    vi.stubEnv('NEXT_PUBLIC_META_TRACKING_ENABLED', '')
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview')
    expect(isMetaTrackingEnabled()).toBe(false)
  })

  it('an unset environment does NOT enable tracking (fails closed)', () => {
    vi.stubEnv('NEXT_PUBLIC_META_TRACKING_ENABLED', '')
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', '')
    expect(isMetaTrackingEnabled()).toBe(false)
  })

  /**
   * Both directions of the override matter. '1' is the escape hatch for a
   * production project whose system environment variables are not exposed to
   * the client bundle; '0' is the one that keeps a production-like environment
   * out of the dataset. Neither is useful if VERCEL_ENV can outvote it.
   */
  it("explicit '0' overrides a production VERCEL_ENV", () => {
    vi.stubEnv('NEXT_PUBLIC_META_TRACKING_ENABLED', '0')
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production')
    expect(isMetaTrackingEnabled()).toBe(false)
  })

  it("explicit '1' overrides a preview VERCEL_ENV", () => {
    vi.stubEnv('NEXT_PUBLIC_META_TRACKING_ENABLED', '1')
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview')
    expect(isMetaTrackingEnabled()).toBe(true)
  })
})

/**
 * `PIXEL_ID` is read at MODULE load, so each case re-imports the module with the
 * environment already stubbed. That is also the honest shape of the production
 * bug: the id is inlined into the bundle at build time and is identical in every
 * environment, which is precisely why possessing it cannot be permission to fire.
 */
describe('MetaPixel — a pixel id is not permission to fire', () => {
  const loadMetaPixel = async () => {
    vi.resetModules()
    return (await import('@/lib/facebook/MetaPixel')).default
  }

  it('returns null when the gate is false, even with a pixel id set', async () => {
    vi.stubEnv('NEXT_PUBLIC_META_PIXEL_ID', '2587091141705317')
    vi.stubEnv('NEXT_PUBLIC_META_TRACKING_ENABLED', '')
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview')
    const MetaPixel = await loadMetaPixel()
    expect(MetaPixel()).toBeNull()
  })

  it('returns null on a laptop with no VERCEL_ENV at all', async () => {
    vi.stubEnv('NEXT_PUBLIC_META_PIXEL_ID', '2587091141705317')
    vi.stubEnv('NEXT_PUBLIC_META_TRACKING_ENABLED', '')
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', '')
    const MetaPixel = await loadMetaPixel()
    expect(MetaPixel()).toBeNull()
  })

  // The counterweight: a gate stuck closed would pass every test above while
  // taking production tracking dark.
  it('still renders the pixel in production', async () => {
    vi.stubEnv('NEXT_PUBLIC_META_PIXEL_ID', '2587091141705317')
    vi.stubEnv('NEXT_PUBLIC_META_TRACKING_ENABLED', '')
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production')
    const MetaPixel = await loadMetaPixel()
    expect(MetaPixel()).not.toBeNull()
  })

  it('still returns null when no pixel id is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_META_PIXEL_ID', '')
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production')
    const MetaPixel = await loadMetaPixel()
    expect(MetaPixel()).toBeNull()
  })
})
