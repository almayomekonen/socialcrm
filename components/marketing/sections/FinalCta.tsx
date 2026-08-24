import { Container, CtaButton, Reveal, Section } from '@/components/marketing/system'

/**
 * The closing beat.
 *
 * Product-oriented, not hype: it restates what actually happens in the first
 * few minutes (connect, import, see the list) rather than promising an outcome
 * we cannot evidence. `winning-angles.md` #5 is the frame — the anti-demo
 * angle — and its reassurance line is a fact, not a scarcity device.
 * `care-charter.md` Law 16 and Law 22 rule out manufactured urgency.
 */
export function FinalCta() {
  return (
    <Section ground='dark' aria-labelledby='final-cta-heading' className='relative isolate overflow-hidden'>
      <div aria-hidden='true' className='pointer-events-none absolute inset-x-0 top-1/2 -z-10 -translate-y-1/2'>
        <div className='absolute left-1/2 h-[300px] w-[min(110%,760px)] -translate-x-1/2 -translate-y-1/2 rounded-[50%] bg-[radial-gradient(ellipse_at_center,color-mix(in_oklab,var(--color-mkt-accent)_26%,transparent),transparent_70%)]' />
      </div>

      <Container className='relative z-10 flex flex-col items-center gap-7 text-center'>
        <Reveal>
          <h2 id='final-cta-heading' className='mkt-h1 max-w-2xl text-balance font-semibold text-mkt-fg'>
            תן למערכת להחזיק את זה במקומך
          </h2>
        </Reveal>
        <Reveal delay={0.06}>
          <p className='mkt-lead max-w-xl text-pretty text-mkt-muted'>
            מחברים את הערוצים, מעלים את האקסל הקיים, ותוך כמה דקות כל הלידים יושבים ברשימה אחת — עם סטטוס, נציג ותאריך
            לחזור.
          </p>
        </Reveal>
        <Reveal delay={0.12}>
          <div className='flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row'>
            <CtaButton href='/auth' className='w-full sm:w-auto'>
              התחל בחינם
            </CtaButton>
            <CtaButton href='/pricing' variant='secondary' className='w-full sm:w-auto'>
              ראה מחירים
            </CtaButton>
          </div>
        </Reveal>
        <Reveal delay={0.16}>
          <p className='mkt-caption text-mkt-faint'>ללא כרטיס אשראי · בלי דמו · בלי הטמעה</p>
        </Reveal>
      </Container>
    </Section>
  )
}
