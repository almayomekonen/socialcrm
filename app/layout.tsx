import '@/lib/css/main.css'
import LayoutPageEvents from '@/lib/hooksNEvents'
import ToastMsg from '@/lib/toast'
import ChunkReloader from '@/lib/ChunkReloader'
import MetaPixel from '@/lib/facebook/MetaPixel'
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
        <div>{children}</div>
      </body>
    </html>
  )
}
