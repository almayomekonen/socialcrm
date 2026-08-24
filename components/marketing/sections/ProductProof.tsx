import { Body, Container, Heading, ProductFrame, Reveal, Section, SectionIntro } from '@/components/marketing/system'
import { ConversationWorkspace } from '@/components/marketing/product/ConversationWorkspace'
import { PipelineBoard } from '@/components/marketing/product/PipelineBoard'

/**
 * The product chapter — conversations, then the pipeline.
 *
 * DARK ground: these are product moments, per the editorial rule in
 * `lib/css/marketing.css`. The light product UI floating on the dark ground is
 * the composition doing the work; no cards are needed to group it.
 *
 * Deliberately NOT a grid of icon cards. Two full-width product compositions
 * with the argument beside them, alternating side, so the page reads as
 * editorial rather than as a feature matrix.
 *
 * Every claim is verified against code:
 *  - delivery/read ticks → `lib/whatsapp/` message statuses
 *    (pending/sent/delivered/read/failed)
 *  - templates → `lib/whatsapp/sendTemplateMessage.ts`
 *  - pipeline stages → `lib/leads/statusStyles.ts`
 *    (חדש / בטיפול / מעוניין / סגור / אבוד)
 */
export function ProductProof() {
  return (
    <Section ground='dark' id='how-it-works' aria-labelledby='proof-heading'>
      <Container width='wide'>
        <Reveal>
          <SectionIntro
            eyebrow='איך זה עובד'
            headingId='proof-heading'
            title='לא צריך להאמין לנו. תראה איך זה עובד.'
            lead='זו המערכת עצמה — השיחות, הסטטוסים והמעקב, כמו שהם נראים בעבודה יומיומית.'
          />
        </Reveal>

        {/* Conversations */}
        <div className='mt-16 grid items-center gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16'>
          <Reveal>
            <Heading as='h3' size='h2'>
              השיחה והליד הם אותו דבר
            </Heading>
            <Body className='mt-4'>
              מחברים את הוואטסאפ העסקי, וכל שיחה מתחברת לליד עם מקור, סטטוס ובעלים. עונים מהמערכת, ורואים מתי ההודעה
              נמסרה ומתי נקראה. כשצריך לפנות שוב, שולחים תבנית מאושרת בלחיצה.
            </Body>
            <ul className='mt-6 flex flex-col gap-3'>
              {[
                'כל הודעה נשמרת על הליד, גם כשנציג מתחלף',
                'סימוני נמסר ונקרא, ישירות מוואטסאפ',
                'תבניות מאושרות לפנייה חוזרת',
              ].map((t) => (
                <li key={t} className='mkt-body flex gap-3 text-mkt-muted'>
                  <span aria-hidden='true' className='mt-2 size-1.5 shrink-0 rounded-full bg-mkt-accent' />
                  {t}
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={0.08}>
            <ProductFrame>
              <ConversationWorkspace />
            </ProductFrame>
          </Reveal>
        </div>

        {/* Pipeline — reversed order on desktop so the page alternates. */}
        <div className='mt-20 grid items-center gap-10 lg:mt-28 lg:grid-cols-[1.2fr_0.8fr] lg:gap-16'>
          <Reveal className='lg:order-2'>
            <Heading as='h3' size='h2'>
              כל ליד יודע איפה הוא עומד
            </Heading>
            <Body className='mt-4'>
              חדש, בטיפול, מעוניין, סגור — ואבוד כשזה נגמר. אלה הסטטוסים שהמערכת עובדת איתם בפועל, בלי שלבים מומצאים
              ובלי טבלה שצריך לתחזק ביד.
            </Body>
            <Body className='mt-4'>
              ליד שנסגר נשאר ליד. אין ישות נפרדת של &quot;לקוח&quot; ואין רשימה שנייה לתחזק.
            </Body>
          </Reveal>

          <Reveal delay={0.08} className='lg:order-1'>
            <ProductFrame>
              <PipelineBoard />
            </ProductFrame>
          </Reveal>
        </div>
      </Container>
    </Section>
  )
}
