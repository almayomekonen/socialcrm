import { Container, Reveal, Section, SectionIntro } from '@/components/marketing/system'
import type { FAQItem } from '@/components/seo/FAQ'

/**
 * The FAQ — native `<details>`, zero JavaScript.
 *
 * The previous FAQ was a 157-line Client Component with tab state. That is a
 * lot of bundle for content whose whole job is to be READ and INDEXED: the
 * answers are the long-form copy the FAQPage markup points at, so they must be
 * in the HTML, expandable without hydration, and findable by in-page search.
 *
 * SCHEMA PARITY IS THE POINT. The array passed here is the SAME array the page
 * hands to `buildFAQSchema`, so the markup cannot claim a question the page does
 * not render. `/crm` previously shipped an 8-item schema list beside a separate,
 * hand-duplicated 12-item render list, and they had drifted — the guardrail
 * suite catches exactly that.
 *
 * LIGHT ground: this is reading, not a product moment.
 */
export function Faq({ items, title = 'שאלות נפוצות', lead }: { items: FAQItem[]; title?: string; lead?: string }) {
  return (
    <Section ground='light' id='faq' aria-labelledby='faq-heading' className='border-t border-mkt-hairline'>
      <Container width='prose'>
        <Reveal>
          <SectionIntro eyebrow='שאלות ותשובות' headingId='faq-heading' title={title} lead={lead} />
        </Reveal>

        <Reveal delay={0.06}>
          <div className='mt-12 divide-y divide-mkt-border border-y border-mkt-border'>
            {items.map((item) => (
              <details key={item.question} className='group'>
                <summary className='flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-start marker:hidden [&::-webkit-details-marker]:hidden'>
                  <h3 className='text-[1.0625rem] font-medium text-mkt-fg'>{item.question}</h3>
                  <span
                    aria-hidden='true'
                    className='grid size-7 shrink-0 place-items-center rounded-full border border-mkt-border text-mkt-muted transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none'
                  >
                    <svg viewBox='0 0 12 12' className='size-3' fill='none'>
                      <path d='M6 1.5v9M1.5 6h9' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' />
                    </svg>
                  </span>
                </summary>
                <p className='mkt-body max-w-prose pb-6 text-mkt-muted'>{item.answer}</p>
              </details>
            ))}
          </div>
        </Reveal>
      </Container>
    </Section>
  )
}
