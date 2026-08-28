import '@/lib/css/main.css'
import LayoutPageEvents from '@/lib/hooksNEvents'
import ToastMsg from '@/lib/toast'
import ChunkReloader from '@/lib/ChunkReloader'
import MetaPixel from '@/lib/facebook/MetaPixel'
import { Analytics } from '@vercel/analytics/next'
import { metaData } from '@/types/vars'
import { Assistant } from 'next/font/google'

/**
 * HEBREW SUBSET — the app's primary language was never being requested.
 *
 * This declared `subsets: ['latin']` only, so next/font fetched a Latin-only
 * Assistant and every Hebrew glyph in the product AND on the marketing site
 * fell back to the system UI font. The typeface was configured but not
 * actually applied to the text it exists for.
 *
 * Strictly additive: Latin is unchanged, and Hebrew now renders in Assistant as
 * intended rather than in a fallback. `display: 'swap'` and the CSS variable are
 * untouched, so nothing about layout or loading behaviour changes.
 */
const font = Assistant({
  subsets: ['hebrew', 'latin'],
  display: 'swap',
  variable: '--font-assistant',
})

export const metadata = metaData

/**
 * `suppressHydrationWarning` on <html> is required by next-themes, which powers
 * the theme toggle on the marketing surface: it writes `class` on <html> before
 * React hydrates, so server and client markup differ by that one attribute by
 * design. The flag applies to THIS element's own attributes only — it does not
 * silence mismatches anywhere inside the tree, and changes nothing at runtime.
 */
export default async function RootLayout({ children }) {
  return (
    <html lang='he' dir='rtl' data-scroll-behavior='smooth' suppressHydrationWarning>
      <body className={font.className}>
        <LayoutPageEvents />
        <ToastMsg />
        <ChunkReloader />
        <MetaPixel />
        {/* Neutral wrapper only — the <main> landmark is owned by each route
            group's layout so there is exactly one <main> per document. */}
        <div>{children}</div>
        {/* Vercel Web Analytics — the included plan only. Loads
            /_vercel/insights/script.js, which is same-origin and therefore
            already covered by the CSP `script-src 'self'` in next.config.mjs. */}
        <Analytics />
      </body>
    </html>
  )
}
