import { Body, Container, ProductFrame, Reveal, Section, SectionIntro } from '@/components/marketing/system'
import { CopilotPanel } from '@/components/marketing/product/CopilotPanel'

/**
 * The AI layer, described as what it is: a reader, not an actor.
 *
 * Bounded by `care-charter.md` and `brand-principles.md` §5:
 *  - Law 1 — the model never produces a business fact. The copy says it reads
 *    the lead's history; it does not claim the AI knows anything the CRM does
 *    not already hold.
 *  - Law 5.4 — nothing goes out without a human pressing send. Stated in the
 *    body copy AND visible in the surface.
 *  - Law 9 — no avatar, no assistant persona, no autonomy claim. This is
 *    explicitly NOT an "AI salesperson".
 *
 * The angle is `winning-angles.md` #3, "Your AI sales partner, not your AI
 * dashboard", and its proof points are the ones listed there and verified in
 * code: the Lead Intelligence Card, three modes, and the shipped actions in
 * `lib/copilot/copilotResponse.ts`.
 *
 * Pro-gated, and the copy says so rather than letting a free user discover it.
 */
export function Copilot() {
  return (
    <Section ground='dark' aria-labelledby='copilot-heading' className='border-t border-mkt-hairline'>
      <Container width='wide'>
        <div className='grid items-start gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16'>
          <Reveal>
            <SectionIntro
              align='start'
              eyebrow='AI Copilot'
              headingId='copilot-heading'
              title='פותחים ליד, וכבר יודעים מה לעשות'
              lead='ה-AI קורא את ההיסטוריה האמיתית של הליד, מסכם איפה זה עומד, ומציע את הצעד הבא. הוא לא ממציא נתונים ולא שולח כלום בעצמו.'
            />

            <Body className='mt-6'>
              על כל ליד יש תקציר, שתי נקודות מפתח ופעולה מומלצת עם הסיבה שלה. אפשר לבקש טיוטה להודעת מעקב, לשאול מה
              הצעד הבא, או פשוט לשאול שאלה על הליד.
            </Body>

            <div className='mt-7 border-s-2 border-mkt-accent ps-4'>
              <p className='mkt-body font-medium text-mkt-fg'>הודעה ללקוח נשלחת רק כשאתה לוחץ שלח.</p>
              <p className='mkt-caption mt-1 text-mkt-faint'>תמיד. גם כשה-AI כתב את הטיוטה.</p>
            </div>

            <p className='mkt-caption mt-7 text-mkt-faint'>שכבת ה-AI נפתחת בתוכנית Pro.</p>
          </Reveal>

          <Reveal delay={0.08}>
            <ProductFrame>
              <CopilotPanel />
            </ProductFrame>
          </Reveal>
        </div>
      </Container>
    </Section>
  )
}
