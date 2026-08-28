import '@/lib/css/main.css'
import LayoutPageEvents from '@/lib/hooksNEvents'
import ToastMsg from '@/lib/toast'
import ChunkReloader from '@/lib/ChunkReloader'
import MetaPixel from '@/lib/facebook/MetaPixel'
import { Analytics } from '@vercel/analytics/next'
import { metaData } from '@/types/vars'
import { Assistant } from 'next/font/google'

const font = Assistant({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-assistant',
})

export const metadata = metaData

export default async function RootLayout({ children }) {
  return (
    <html lang='he' dir='rtl' data-scroll-behavior='smooth'>
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
