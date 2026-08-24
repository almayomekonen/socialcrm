import { Body, Container, Heading, ProductFrame, Reveal, Section, SectionIntro } from '@/components/marketing/system'
import { ScatteredInflow, UnifiedInflow } from '@/components/marketing/product/ChannelInflow'

/**
 * The problem, then its resolution — the same four arrivals shown twice, so the
 * difference is read rather than asserted.
 *
 * Copy is grounded in `marketing-knowledge/pain-points.md` ("The structural
 * pain", "What they currently do") and voiced per `brand.md`: short, direct, no
 * marketing fluff. Nothing here counts the reader's misses — `care-charter.md`
 * Law 13 forbids reporting a user's neglect back to them.
 */
export function Problem() {
  return (
    <Section ground='light' aria-labelledby='problem-heading' className='border-t border-mkt-hairline'>
      <Container>
        <Reveal>
          <SectionIntro
            eyebrow='הבעיה'
            headingId='problem-heading'
            title='הלידים לא נעלמים. הם מתפזרים.'
            lead='פנייה בוואטסאפ, טופס בפייסבוק, הודעה באינסטגרם. כל אחת נוחתת במקום אחר, ואף אחת מהן לא יודעת על השנייה.'
          />
        </Reveal>

        <div className='mt-14 grid items-start gap-10 lg:mt-16 lg:grid-cols-2 lg:gap-14'>
          <Reveal>
            <Heading as='h3' size='h3'>
              בלי מערכת
            </Heading>
            <Body className='mt-2 mb-6'>
              שלוש אפליקציות, שלוש רשימות. אף אחת מהן לא אומרת מי כבר טופל ומי עדיין מחכה, ומה שמחזיק את זה יחד הוא
              הזיכרון שלך.
            </Body>
            <ScatteredInflow />
          </Reveal>

          <Reveal delay={0.08}>
            <Heading as='h3' size='h3'>
              עם SocialCRM
            </Heading>
            <Body className='mt-2 mb-6'>
              אותן פניות בדיוק, ברשימה אחת. לכל אחת מקור, סטטוס ובעלים — כך שאף אחת מהן לא תלויה בזה שמישהו יזכור
              אותה.
            </Body>
            <ProductFrame bare>
              <UnifiedInflow />
            </ProductFrame>
          </Reveal>
        </div>
      </Container>
    </Section>
  )
}
