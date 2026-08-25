'use client'

import { usePathname } from 'next/navigation'
import { MarketingHeader } from './MarketingHeader'
import { MarketingFooter } from './MarketingFooter'
import { ThemeProvider } from '@/components/lumen/theme-provider'
import Navbar from '@/components/lumen/layout/navbar'
import Footer from '@/components/lumen/layout/footer'

/**
 * Route-aware marketing chrome — the ONE place the shell split is decided.
 *
 * Three shells exist while the Lumen transformation rolls out:
 *
 *   SELF_SHELLED   `/`, `/pricing`, `/channels`, `/faq` mount their own
 *                  ThemeProvider + `.lumen` + Navbar/Footer inside the page,
 *                  because each also needs the wrapper for its own sections.
 *                  The frame stands back and renders only <main>.
 *
 *   LUMEN_SHELLED  The legal pages. They are pure content — they import no
 *                  shell at all — so the frame gives them the SAME Lumen shell
 *                  the self-shelled routes build, using the same components
 *                  with the same props. Nothing is re-created or approximated.
 *
 *   (default)      Everything else — `/thank-you` and the SEO acquisition
 *                  pages — keeps the Stage 3/4 chrome, untouched.
 *
 * WHY THE LEGAL PAGES ARE WRAPPED WHOLE, CONTENT INCLUDED. The self-shelled
 * routes put Navbar, content and Footer inside one `.lumen` div; wrapping only
 * the chrome would leave the content on a different ground and produce a seam
 * at both edges. `.lumen` paints an opaque ground, but every legal page renders
 * inside `<Section ground='light'>`, which declares its own light ground AND
 * its matching foreground — so the 1.03:1 dark-on-dark defect that this
 * protection exists to prevent cannot return through this change. The theme is
 * pinned to light (`enableSystem={false}`) exactly as the other Lumen routes
 * pin it, so no system dark preference can reach the legal copy either.
 */

/** Routes that mount the Lumen shell themselves; the frame renders only <main>. */
const SELF_SHELLED = new Set(['/', '/pricing', '/channels', '/faq'])

/** Content-only routes that receive the Lumen shell from here. */
const LUMEN_SHELLED = new Set(['/terms', '/privacy', '/data-deletion'])

export function ShellFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (SELF_SHELLED.has(pathname)) return <main>{children}</main>

  if (LUMEN_SHELLED.has(pathname)) {
    return (
      <ThemeProvider attribute='class' defaultTheme='light' enableSystem={false} disableTransitionOnChange>
        <div className='lumen min-h-screen' dir='rtl'>
          <Navbar initialBannerVisible={false} />
          <main>{children}</main>
          <Footer />
        </div>
      </ThemeProvider>
    )
  }

  return (
    <>
      <MarketingHeader />
      <main>{children}</main>
      <MarketingFooter />
    </>
  )
}
