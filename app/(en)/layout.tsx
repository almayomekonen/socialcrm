import '@/lib/css/main.css'
import { Analytics } from '@vercel/analytics/next'
import { Assistant } from 'next/font/google'

/**
 * Root layout for the English marketing site at `/en`.
 *
 * Its own root layout (not a nested one) so `lang` and `dir` are in the
 * server-rendered HTML of the first response.
 *
 * The Hebrew subset is here because the product mockups and the published
 * business address on the English page are in Hebrew.
 *
 * `suppressHydrationWarning` on <html> is required by next-themes, as in the
 * Hebrew root.
 */
const font = Assistant({
  subsets: ['hebrew', 'latin'],
  display: 'swap',
  variable: '--font-assistant',
})

export default function EnglishRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='en' dir='ltr' data-scroll-behavior='smooth' suppressHydrationWarning>
      <body className={font.className}>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
