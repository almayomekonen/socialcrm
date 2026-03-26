'use client'

import Link from 'next/link'

const NAV_LINKS = [
  { label: 'ניהול לידים', href: '/crm' },
  { label: "פיצ'רים", href: '/features' },
  { label: 'פייסבוק', href: '/facebook-leads' },
  { label: 'וואטסאפ', href: '/whatsapp-leads' },
  { label: 'vs CRM אקסל', href: '/crm-vs-excel' },
]

const FOOTER_LINKS = [
  { label: 'דף הבית', href: '/' },
  { label: 'ניהול לידים', href: '/crm' },
  { label: "פיצ'רים", href: '/features' },
  { label: 'לידים מפייסבוק', href: '/facebook-leads' },
  { label: 'לידים מוואטסאפ', href: '/whatsapp-leads' },
  { label: 'CRM לעומת אקסל', href: '/crm-vs-excel' },
  { label: 'הרשמה', href: '/auth/register' },
  { label: 'מדיניות פרטיות', href: '/privacy' },
  { label: 'מחיקת נתונים', href: '/data-deletion' },
  { label: 'תנאי שירות', href: '/terms' },
]

export function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className='min-h-screen bg-white'>
      <header className='flex items-center justify-between px-8 py-4 border-b border-gray-100 bg-white'>
        <Link href='/' className='font-bold text-xl' style={{ color: '#3f20f5' }}>
          SocialCRM
        </Link>
        <nav className='hidden lg:flex gap-6 text-sm' aria-label='ניווט ראשי'>
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className='text-gray-600 hover:text-gray-900 transition-colors'>
              {link.label}
            </Link>
          ))}
        </nav>
        <Link
          href='/auth'
          className='px-4 py-2 rounded-lg text-white text-sm font-semibold'
          style={{ backgroundColor: '#3f20f5' }}
        >
          התחבר בחינם
        </Link>
      </header>

      <main>{children}</main>

      <footer className='py-10 px-8 border-t border-gray-100'>
        <div className='max-w-4xl mx-auto'>
          <div className='flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-gray-400 mb-6'>
            {FOOTER_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className='hover:text-gray-600 transition-colors'>
                {link.label}
              </Link>
            ))}
          </div>
          <p className='text-center text-xs text-gray-500'>
            © {new Date().getFullYear()} SocialCRM מערכת ניהול לידים לעסקים קטנים בישראל
          </p>
        </div>
      </footer>
    </div>
  )
}
