import Link from 'next/link'
import { Container, Reveal, Section, SectionIntro } from '@/components/marketing/system'
import { ChannelMark } from '@/components/marketing/product/chrome'

/**
 * Where the leads come from — and an honest boundary on each.
 *
 * `brand-principles.md` §1.3 requires stating what the product does NOT cover
 * rather than letting the user discover it. So the Instagram card says plainly
 * that direct messages are added manually: Instagram does not let external
 * systems read message content, and the product does not pretend otherwise.
 * This is the section's most important sentence, and `docs/seo-design-reference.md`
 * §12.1 identifies the existing page's version of it as the clearest instance
 * of accuracy over promise in the whole site. It stays.
 *
 * Verified: Facebook Lead Ads ingestion (`lib/facebook/metaLeadConversion.ts`),
 * WhatsApp two-way inbox (`lib/whatsapp/`), Instagram ads via the same Meta
 * lead path.
 */

const CHANNELS: {
  channel: 'whatsapp' | 'facebook' | 'instagram'
  title: string
  body: string
  note: string
  href: string
}[] = [
  {
    channel: 'whatsapp',
    title: 'וואטסאפ עסקי',
    body: 'מחברים את המספר העסקי, וכל שיחה הופכת לליד מנוהל. עונים מהמערכת ורואים מתי נמסר ונקרא.',
    note: 'שיחות דו-כיווניות',
    href: '/whatsapp-leads',
  },
  {
    channel: 'facebook',
    title: 'פייסבוק Lead Ads',
    body: 'מחברים את הדף העסקי, וכל טופס שממולא נכנס למערכת תוך שניות עם מקור וסטטוס.',
    note: 'נכנס אוטומטית',
    href: '/facebook-leads',
  },
  {
    channel: 'instagram',
    title: 'אינסטגרם',
    body: 'לידים ממודעות נכנסים אוטומטית. פניות בהודעה ישירה מוסיפים ידנית בעשר שניות — אינסטגרם לא מאפשר למערכות חיצוניות לקרוא הודעות.',
    note: 'מודעות אוטומטית · הודעות ידנית',
    href: '/instagram-leads-crm',
  },
]

export function Channels() {
  return (
    <Section ground='light' aria-labelledby='channels-heading'>
      <Container>
        <Reveal>
          <SectionIntro
            eyebrow='ערוצים'
            headingId='channels-heading'
            title='הלידים מגיעים מכל מקום. העבודה נעשית במקום אחד.'
            lead='שלושת הערוצים שדרכם עסק קטן בישראל מקבל פניות, וכל אחד עם הגבולות האמיתיים שלו.'
          />
        </Reveal>

        <div className='mt-14 grid gap-px overflow-hidden rounded-mkt-xl border border-mkt-border bg-mkt-border sm:grid-cols-3'>
          {CHANNELS.map((c, i) => (
            <Reveal key={c.channel} delay={0.06 * i} className='bg-mkt-bg'>
              <Link href={c.href} className='group flex h-full flex-col p-6 transition-colors hover:bg-mkt-surface lg:p-8'>
                <ChannelMark channel={c.channel} size={36} />
                <h3 className='mkt-h3 mt-5 font-semibold text-mkt-fg'>{c.title}</h3>
                <p className='mkt-caption mt-1.5 font-medium text-mkt-accent-text'>{c.note}</p>
                <p className='mkt-body mt-3 text-mkt-muted'>{c.body}</p>
                <span className='mkt-caption mt-auto pt-6 font-medium text-mkt-fg'>
                  קרא עוד
                  <span aria-hidden='true' className='inline-block ps-1 transition-transform group-hover:-translate-x-0.5'>
                    ←
                  </span>
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  )
}
