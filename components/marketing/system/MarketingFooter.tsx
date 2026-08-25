import Link from 'next/link'
import { Container } from './Container'

/**
 * The footer, and the site's internal-link spine.
 *
 * Every marketing route is reachable from every page here. The old site put a
 * hand-rolled "ראה גם" strip on three of six landing pages and nowhere else, so
 * link equity was distributed by accident. One footer, one link graph.
 *
 * Server Component — the previous footer was `'use client'` for a set of static
 * links.
 */

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: 'המוצר',
    links: [
      { label: 'ניהול לידים', href: '/' },
      { label: 'כל היכולות', href: '/' },
      { label: 'מחירים', href: '/pricing' },
    ],
  },
  {
    title: 'ערוצים',
    links: [
      { label: 'לידים מוואטסאפ', href: '/channels' },
      { label: 'CRM לוואטסאפ עסקי', href: '/channels' },
      { label: 'לידים מפייסבוק', href: '/channels' },
      { label: 'לידים מאינסטגרם', href: '/channels' },
    ],
  },
  {
    title: 'להשוואה',
    links: [
      { label: 'CRM לעומת אקסל', href: '/crm-vs-excel' },
      { label: 'שאלות נפוצות', href: '/faq' },
    ],
  },
  {
    title: 'מידע',
    links: [
      { label: 'מדיניות פרטיות', href: '/privacy' },
      { label: 'תנאי שימוש', href: '/terms' },
      { label: 'מחיקת נתונים', href: '/data-deletion' },
    ],
  },
]

const SOCIAL = [
  { icon: 'facebook-color', label: 'פייסבוק', href: 'https://www.facebook.com/share/1BZNFrLH9R/?mibextid=wwXIfr' },
  { icon: 'instagram-color', label: 'אינסטגרם', href: 'https://www.instagram.com/socialcrm.ai?igsh=cWVvc2FuMHFtM3R3&utm_source=qr' },
  { icon: 'gmail', label: 'אימייל', href: 'mailto:alamayo274@gmail.com' },
]

export function MarketingFooter() {
  return (
    <footer className='mkt-ground-light border-t border-mkt-border'>
      <Container width='wide' className='py-16 lg:py-20'>
        <div className='grid gap-12 lg:grid-cols-[1.5fr_repeat(4,1fr)]'>
          <div>
            <div className='flex items-center gap-2.5 font-semibold text-mkt-fg'>
              <span
                aria-hidden='true'
                className='grid size-7 place-items-center rounded-mkt-md bg-mkt-ink text-[13px] font-bold text-white'
              >
                S
              </span>
              SocialCRM
            </div>
            <p className='mkt-body mt-4 max-w-xs text-mkt-muted'>
              כל הלידים מפייסבוק, מאינסטגרם ומוואטסאפ במקום אחד, עם שיחה, סטטוס ומעקב לכל ליד.
            </p>
            <p className='mkt-caption mt-6 whitespace-pre-line text-mkt-faint'>
              {'מופעל על ידי:\nאלמיהו מקונן (עוסק פטור)\n\nשם מסחרי:\nSocialCRM'}
            </p>
            <div className='mt-6 flex items-center gap-4'>
              {SOCIAL.map((s) => (
                <Link
                  key={s.label}
                  href={s.href}
                  aria-label={s.label}
                  {...(s.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  className='grid size-11 place-items-center rounded-mkt-md opacity-70 transition-opacity hover:opacity-100'
                >
                  <span
                    aria-hidden='true'
                    className='block size-5'
                    style={{
                      backgroundImage: `url(/media/social-icons/${s.icon}.svg)`,
                      backgroundRepeat: 'no-repeat',
                      backgroundPosition: 'center',
                      backgroundSize: 'contain',
                    }}
                  />
                </Link>
              ))}
            </div>
          </div>

          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h2 className='mkt-caption font-semibold tracking-[0.1em] text-mkt-faint'>{col.title}</h2>
              <ul className='mt-4 flex flex-col'>
                {col.links.map((l) => (
                  <li key={l.href + l.label}>
                    <Link
                      href={l.href}
                      className='flex min-h-11 items-center text-[0.9375rem] text-mkt-muted transition-colors hover:text-mkt-fg'
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className='mkt-caption mt-14 flex flex-col gap-2 border-t border-mkt-border pt-6 text-mkt-faint sm:flex-row sm:items-center sm:justify-between'>
          {/*
            No `new Date()`. Next 16 rejects reading the current time in a
            Server Component without a request-data source, and
            architecture-rules.md §11 bans ad-hoc date derivation — a year
            computed on both server and client is the same timezone-mismatch
            hazard that crashed /dashboard.
          */}
          <p>© SocialCRM. כל הזכויות שמורות.</p>
          <p>נבנה בישראל</p>
        </div>
      </Container>
    </footer>
  )
}
