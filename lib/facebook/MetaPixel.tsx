'use client'

import Script from 'next/script'
import { Suspense, useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { ensureFbq } from './fbqBootstrap'

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID

/**
 * Fires once per document, never per render. `MetaPixel` is mounted in the root
 * layout, which does not remount on client navigation, so this matches the old
 * inline snippet exactly: one `init`, one initial `PageView`. The module flag
 * additionally absorbs React StrictMode's double-invoked effects in dev, which
 * the inline script never had to worry about.
 */
let booted = false

function PixelBootstrap({ pixelId }: { pixelId: string }) {
  useEffect(() => {
    if (booted) return
    booted = true
    ensureFbq()
    window.fbq?.('init', pixelId)
    window.fbq?.('track', 'PageView')
  }, [pixelId])

  return null
}

function RouteChangeTracker() {
  const pathname = usePathname()
  const isFirstLoad = useRef(true)

  useEffect(() => {
    if (isFirstLoad.current) {
      isFirstLoad.current = false
      return
    }
    window.fbq?.('track', 'PageView')
  }, [pathname])

  return null
}

/**
 * Meta Pixel — no inline script.
 *
 * The published snippet used to live here as inline `<Script>` children, which
 * made it the ONE application-owned inline script in the document that actually
 * executes. It is now split in two, with identical behaviour: the stub and the
 * `init`/`PageView` calls are bundled module code (`fbqBootstrap.ts` +
 * `PixelBootstrap`), and fbevents.js loads through `next/script` with the same
 * `afterInteractive` strategy and the same URL it always used.
 *
 * The pixel id is `NEXT_PUBLIC_*`, so it is inlined into the client bundle at
 * build time — there is no runtime value that has to stay in the document, and
 * therefore no reason to reach for a /public file or a data- attribute.
 *
 * CSP is untouched: `connect.facebook.net` was already in `script-src`, and an
 * external script element is what that allowlist entry has always covered.
 */
export default function MetaPixel() {
  if (!PIXEL_ID) return null

  return (
    <>
      <Script src='https://connect.facebook.net/en_US/fbevents.js' strategy='afterInteractive' />
      <PixelBootstrap pixelId={PIXEL_ID} />
      <Suspense fallback={null}>
        <RouteChangeTracker />
      </Suspense>
    </>
  )
}
