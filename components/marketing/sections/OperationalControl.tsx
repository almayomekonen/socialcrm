import { Body, Container, ProductFrame, Reveal, Section, SectionIntro } from '@/components/marketing/system'
import { FollowUpQueue } from '@/components/marketing/product/FollowUpQueue'

/**
 * Operational control — the "the system holds it, not your head" beat.
 *
 * ⚠️ WHAT THIS SECTION DELIBERATELY DOES NOT CLAIM.
 *
 * The Customer Automation Engine (`lib/automations/flags.ts`) is allowlist-
 * gated, `AUTOMATIONS_ENABLED` defaults to off, `getAutomationsSendMode()`
 * defaults to `'log'`, and `getAutomationsFrom()` is empty — it cannot send.
 * It is therefore not marketed anywhere on this site, and this section is
 * written to be true without it.
 *
 * What IS claimed is verified:
 *  - SLA windows — `SLA_HOURS_BY_STATUS = { contacted: 24, interested: 72 }`
 *    in `lib/today/constants.ts`. The numbers in the copy are those numbers.
 *  - Follow-up dates that resurface a lead on the day.
 *  - Tasks and reusable task templates.
 *
 * The language is careful: the list is something the system SHOWS you, not
 * something it does behind your back. That distinction is the difference
 * between accurate and invented here.
 */
export function OperationalControl() {
  return (
    <Section ground='dark' aria-labelledby='control-heading'>
      <Container width='wide'>
        <div className='grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16'>
          <Reveal className='lg:order-2'>
            <SectionIntro
              align='start'
              eyebrow='שליטה'
              headingId='control-heading'
              title='לא צריך לזכור מי מחכה לתשובה'
              lead='כל ליד מקבל תאריך לחזור אליו, וכשמגיע הזמן הוא חוזר לרשימה של היום. אתה פותח את המערכת ורואה מה באמת צריך אותך.'
            />

            <Body className='mt-6'>
              ליד שנמצא בטיפול ולא קיבל מענה מעל 24 שעות עולה למעלה. ליד שקיבל הצעה ולא היה איתו מגע 72 שעות עולה גם
              הוא. אלה לא כללים שצריך להגדיר — זה מה שהמערכת מציגה לך כשאתה נכנס.
            </Body>

            <ul className='mt-6 flex flex-col gap-3'>
              {[
                'תאריך מעקב לכל ליד, שמחזיר אותו לרשימת היום',
                'משימות ותבניות משימה לתהליכים חוזרים',
                'היסטוריה מלאה על הליד, גם כשנציג מתחלף',
              ].map((t) => (
                <li key={t} className='mkt-body flex gap-3 text-mkt-muted'>
                  <span aria-hidden='true' className='mt-2 size-1.5 shrink-0 rounded-full bg-mkt-accent' />
                  {t}
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={0.08} className='lg:order-1'>
            <ProductFrame>
              <FollowUpQueue />
            </ProductFrame>
          </Reveal>
        </div>
      </Container>
    </Section>
  )
}
