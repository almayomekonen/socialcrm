'use client'

import Footer4Col from '@/components/ui/footer-column'

export function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className='min-h-screen' style={{ backgroundColor: '#0a0a0a' }}>
      <main>{children}</main>
      <Footer4Col />
    </div>
  )
}
