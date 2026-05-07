'use client'

import Link from 'next/link'
import Icon from '@/lib/Icon'

const solutions = [
  { text: 'ניהול לידים', href: '/crm' },
  { text: "פיצ'רים", href: '/features' },
  { text: 'לידים מפייסבוק', href: '/facebook-leads' },
  { text: 'לידים מוואטסאפ', href: '/whatsapp-leads' },
  { text: 'CRM לעומת אקסל', href: '/crm-vs-excel' },
]

const resources = [
  { text: 'שאלות נפוצות', href: '/crm#faq' },
  { text: 'איך זה עובד', href: '/crm#how-it-works' },
  { text: 'ניהול לידים המדריך', href: '/crm' },
  { text: 'לידים ממדיה חברתית', href: '/facebook-leads' },
  { text: 'ייבוא מאקסל', href: '/features' },
]

const company = [
  { text: 'הרשמה בחינם', href: '/auth/register' },
  { text: 'מדיניות פרטיות', href: '/privacy' },
  { text: 'תנאי שירות', href: '/terms' },
  { text: 'מחיקת נתונים', href: '/data-deletion' },
]

const socialIcons = [
  { name: 'square-f' as const, label: 'פייסבוק', href: '#' },
  { name: 'at' as const, label: 'אינסטגרם', href: '#' },
  { name: 'comment-dots' as const, label: 'וואטסאפ', href: '#' },
  { name: 'paper-plane' as const, label: 'מייל', href: 'mailto:hello@socialcrm.co.il' },
]

export default function Footer4Col() {
  return (
    <footer style={{ backgroundColor: '#0a0a0a' }} dir='rtl'>
      <div className='mx-auto max-w-7xl px-6 pt-16 pb-8 lg:px-8 lg:pt-20'>
        <div className='grid grid-cols-1 gap-10 lg:grid-cols-4'>

          {/* Brand column */}
          <div className='lg:col-span-1'>
            <div className='flex items-center gap-3'>
              <div
                className='w-10 h-10 rounded-full flex items-center justify-center shrink-0'
                style={{ backgroundColor: '#3f20f5' }}
              >
                <Icon name='inbox' className='size-5 bg-white' />
              </div>
              <span className='text-white text-xl font-bold'>SocialCRM</span>
            </div>

            <p className='text-white/40 mt-5 text-sm leading-relaxed max-w-xs'>
              מערכת ניהול לידים לעסקים קטנים בישראל. מחברים בין פייסבוק, אינסטגרם ווואטסאפ למקום אחד בלי לפספס אף ליד.
            </p>

            <div className='mt-6 flex items-center gap-5'>
              {socialIcons.map(({ name, label, href }) => (
                <Link
                  key={label}
                  href={href}
                  aria-label={label}
                >
                  <Icon name={name} className='size-5 bg-white/40 hover:bg-white transition-colors' />
                </Link>
              ))}
            </div>
          </div>

          {/* Link columns */}
          <div className='lg:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-8'>
            <div>
              <p className='text-white text-sm font-semibold uppercase tracking-wider'>פתרונות</p>
              <ul className='mt-6 space-y-3'>
                {solutions.map(({ text, href }) => (
                  <li key={text}>
                    <Link href={href} className='text-white/50 text-sm hover:text-white transition-colors'>
                      {text}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className='text-white text-sm font-semibold uppercase tracking-wider'>משאבים</p>
              <ul className='mt-6 space-y-3'>
                {resources.map(({ text, href }) => (
                  <li key={text}>
                    <Link href={href} className='text-white/50 text-sm hover:text-white transition-colors'>
                      {text}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className='text-white text-sm font-semibold uppercase tracking-wider'>חברה</p>
              <ul className='mt-6 space-y-3'>
                {company.map(({ text, href }) => (
                  <li key={text}>
                    <Link href={href} className='text-white/50 text-sm hover:text-white transition-colors'>
                      {text}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className='mt-16 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4'>
          <p className='text-white/30 text-sm'>
            &copy; {new Date().getFullYear()} SocialCRM. כל הזכויות שמורות.
          </p>
          <div className='flex items-center gap-6 text-sm text-white/30'>
            <Link href='/terms' className='hover:text-white transition-colors'>תנאי שירות</Link>
            <Link href='/privacy' className='hover:text-white transition-colors'>מדיניות פרטיות</Link>
            <Link href='/data-deletion' className='hover:text-white transition-colors'>מחיקת נתונים</Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
