import { Container, CtaButton, Reveal, Section, SectionIntro } from '@/components/marketing/system'

/**
 * Free vs Pro, in the Lumen pricing grammar: two plans, the recommended one
 * carrying the accent, features as plain statements.
 *
 * The commercial ask lives here and only here. `care-charter.md` §12 (Law 21)
 * keeps care and commerce in separate rooms — no countdown, no scarcity, and
 * nothing that borrows the relief the rest of the page just created (Law 23).
 *
 * Verified: free tier is 50 leads per agency; Pro removes the cap and opens the
 * AI layer. The monthly figure is deliberately omitted here and left to
 * `/pricing`, which owns it — duplicating a price in two places is how they
 * drift.
 */

const PLANS = [
  {
    name: 'חינם',
    price: '₪0',
    cadence: 'לתמיד',
    body: 'כל מה שצריך כדי להתחיל לנהל לידים באמת.',
    features: [
      'עד 50 לידים',
      'חיבור לפייסבוק, אינסטגרם ווואטסאפ',
      'סטטוסים, נציגים ותאריכי מעקב',
      'ייבוא מאקסל, ייצוא לאקסל ו-PDF',
    ],
    cta: { label: 'התחל בחינם', href: '/auth' },
    featured: false,
  },
  {
    name: 'Pro',
    price: 'ללא הגבלה',
    cadence: 'מחיר אחד לסביבת העבודה',
    body: 'בלי מגבלת לידים, ועם שכבת ה-AI שמכירה כל ליד.',
    features: [
      'לידים ללא הגבלה',
      'תקציר חכם ופעולה מומלצת על כל ליד',
      'טיוטות להודעות מעקב',
      'מחיר אחד לצוות, בלי תוספת לכל נציג',
    ],
    cta: { label: 'ראה את המחירים', href: '/pricing' },
    featured: true,
  },
]

function Check() {
  return (
    <svg aria-hidden='true' viewBox='0 0 16 16' className='mt-1 size-4 shrink-0 text-mkt-accent' fill='none'>
      <path d='m3.5 8.5 3 3 6-7' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  )
}

export function PricingPreview() {
  return (
    <Section ground='light' aria-labelledby='pricing-heading'>
      <Container>
        <Reveal>
          <SectionIntro
            eyebrow='מחירים'
            headingId='pricing-heading'
            title='המערכת חינמית. ה-AI נפתח ב-Pro.'
            lead='מתחילים בלי כרטיס אשראי, ומשדרגים רק אם וכאשר זה באמת שווה את זה.'
          />
        </Reveal>

        <div className='mx-auto mt-14 grid max-w-3xl gap-4 sm:grid-cols-2'>
          {PLANS.map((p, i) => (
            <Reveal key={p.name} delay={0.06 * i}>
              <div
                className={
                  p.featured
                    ? 'flex h-full flex-col rounded-mkt-xl border-2 border-mkt-ink bg-mkt-surface p-6 sm:p-7'
                    : 'flex h-full flex-col rounded-mkt-xl border border-mkt-border bg-mkt-surface p-6 sm:p-7'
                }
              >
                <div className='flex items-center gap-2'>
                  <h3 className='mkt-h3 font-semibold text-mkt-fg'>{p.name}</h3>
                  {p.featured && (
                    <span className='mkt-caption rounded-full bg-mkt-ink px-2.5 py-0.5 font-medium text-white'>
                      מומלץ
                    </span>
                  )}
                </div>

                <p className='mt-4 flex flex-wrap items-baseline gap-2'>
                  <span className='mkt-h2 font-semibold text-mkt-fg'>{p.price}</span>
                  <span className='mkt-caption text-mkt-faint'>{p.cadence}</span>
                </p>

                <p className='mkt-body mt-3 text-mkt-muted'>{p.body}</p>

                <ul className='mt-6 flex flex-col gap-2.5'>
                  {p.features.map((f) => (
                    <li key={f} className='mkt-body flex gap-2.5 text-mkt-muted'>
                      <Check />
                      {f}
                    </li>
                  ))}
                </ul>

                <div className='mt-7 pt-1'>
                  <CtaButton
                    href={p.cta.href}
                    variant={p.featured ? 'primary' : 'secondary'}
                    size='md'
                    className='w-full'
                  >
                    {p.cta.label}
                  </CtaButton>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  )
}
