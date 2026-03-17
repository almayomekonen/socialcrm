import '@/lib/css/main.css'
import LayoutPageEvents from '@/lib/hooksNEvents'
import ToastMsg from '@/lib/toast'
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
        <main>{children}</main>
      </body>
    </html>
  )
}
