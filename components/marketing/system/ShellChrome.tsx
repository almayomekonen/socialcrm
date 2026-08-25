'use client'

import { usePathname } from 'next/navigation'
import { MarketingHeader } from './MarketingHeader'
import { MarketingFooter } from './MarketingFooter'

/**
 * Route-aware marketing chrome.
 *
 * `/` is the Lumen homepage and brings its own navbar and footer — the real
 * ones from the purchased template. Every other marketing route still uses the
 * Stage 3/4 chrome. This component keeps that split in ONE place so the
 * other SEO pages need no edits at all while `/crm` is proved out.
 *
 * When the transformation rolls out to the remaining routes, this file is
 * deleted and Lumen's layout components move into the layout permanently.
 */

/** Routes that render their own shell. */
const SELF_SHELLED = new Set(['/', '/pricing', '/channels', '/faq'])

export function ShellHeader() {
  const pathname = usePathname()
  if (SELF_SHELLED.has(pathname)) return null
  return <MarketingHeader />
}

export function ShellFooter() {
  const pathname = usePathname()
  if (SELF_SHELLED.has(pathname)) return null
  return <MarketingFooter />
}
