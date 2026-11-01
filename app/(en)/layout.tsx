import '@/lib/css/main.css'
import { Assistant } from 'next/font/google'

/**
 * Root layout for the English marketing site at `/en`.
 *
 * Its own root layout (not a nested one) so `lang` and `dir` are in the
 * server-rendered HTML of the first response. Placeholder only: the content
 * and the Arabic typeface arrive with the translated pages.
 */
const font = Assistant({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-assistant',
})

export default function EnglishRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='en' dir='ltr' data-scroll-behavior='smooth'>
      <body className={font.className}>{children}</body>
    </html>
  )
}
