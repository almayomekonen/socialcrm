import { Container, CtaButton, ProductFrame, Section } from '@/components/marketing/system'
import { LeadsWorkspace } from '@/components/marketing/product/LeadsWorkspace'

/**
 * The hero — the visual reference for the whole marketing site.
 *
 * Composition follows the Lumen grammar established in Stage 3: eyebrow →
 * display headline → lead → paired actions → the product, framed and lifted.
 * Two departures, both deliberate:
 *
 *  1. The headline is SOLID, not gradient-clipped. Lumen's hero clips its
 *     headline to a gradient; ported directly it computed to rgba(0,0,0,0) and
 *     the most important element on the page rendered invisible. A clipped
 *     headline is also one CSS failure from unreadable and behaves badly under
 *     forced-colors. The premium read comes from the scale and the spacing.
 *  2. The ground is LIGHT. The product UI is light, and floating it on a light
 *     ground with a soft accent wash reads calmer and more editorial than the
 *     near-black hero the old site used — and it keeps the first screen of a
 *     Hebrew SEO page on the ground the rest of the copy uses.
 *
 * The h1 carries the homepage's primary intent ("כל הלידים… במקום אחד") in the
 * product's own words from `content-hooks.md`, without keyword stuffing.
 *
 * Server Component: above-the-fold content is HTML on first byte, and the
 * entrance is CSS-only so it cannot delay LCP.
 */
export function Hero() {
  return (
    <Section ground='light' flush className='relative isolate overflow-hidden pt-14 pb-0 sm:pt-20'>
      {/* Accent wash. Decorative, behind everything, and the only place the
          brand colour appears as atmosphere rather than as a fill. */}
      <div aria-hidden='true' className='pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px]'>
        <div className='absolute left-1/2 top-[-180px] h-[420px] w-[min(120%,900px)] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(ellipse_at_center,color-mix(in_oklab,var(--color-mkt-accent)_18%,transparent),transparent_70%)]' />
      </div>

      <Container width='wide' className='relative z-10 flex flex-col items-center gap-6 text-center sm:gap-7'>
        <p className='mkt-reveal mkt-reveal-in inline-flex items-center gap-2 rounded-full border border-mkt-border bg-mkt-surface px-3 py-1.5 mkt-caption text-mkt-muted'>
          <span className='font-semibold text-mkt-fg'>וואטסאפ, פייסבוק ואינסטגרם</span>
          <span aria-hidden='true' className='size-1 rounded-full bg-mkt-faint' />
          במערכת אחת
        </p>

        <h1 className='mkt-display max-w-4xl font-semibold text-balance text-mkt-fg'>
          כל הלידים שלך.
          <br />
          במקום אחד.
        </h1>

        <p className='mkt-lead max-w-xl text-pretty text-mkt-muted'>
          לידים ממודעות פייסבוק ואינסטגרם נכנסים אוטומטית, שיחות וואטסאפ מתחברות לליד, ולכל אחד יש סטטוס, נציג ותאריך
          לחזור אליו.
        </p>

        <div className='flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row'>
          <CtaButton href='/auth' className='w-full sm:w-auto'>
            התחל בחינם
          </CtaButton>
          <CtaButton href='#how-it-works' variant='secondary' className='w-full sm:w-auto'>
            תראה לי איך זה עובד
          </CtaButton>
        </div>

        <p className='mkt-caption text-mkt-faint'>ללא כרטיס אשראי · חינם עד 50 לידים</p>

        {/* The product. Widest element on the page, and the proof. */}
        <div className='relative mt-4 w-full sm:mt-8'>
          <ProductFrame className='mx-auto max-w-5xl'>
            <LeadsWorkspace />
          </ProductFrame>
        </div>
      </Container>
    </Section>
  )
}
