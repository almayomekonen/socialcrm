'use client'

import { Lightbulb, Sparkles } from 'lucide-react'
import { proToast } from '@/lib/toast'

/**
 * The Pro teaser for the lead summary card.
 *
 * DON'T HIDE THE VALUE, HIDE THE COST. An expired customer used to get nothing
 * where the summary lives, which taught them the product had less in it than it
 * does. This shows the shape of the insight and withholds only the insight.
 *
 * WHAT IS DRAWN IS NOT CONTENT. Every blurred row is an empty `div` sized to
 * echo the real card's rhythm — a paragraph, three bullets, a recommended
 * action. There is deliberately NO text behind the blur: invented Hebrew would
 * read as a fabricated insight the moment anyone squinted at it or inspected the
 * DOM, and real customer data must never sit behind a blur that CSS alone
 * enforces. Nothing here is derived from the lead, so nothing can leak.
 *
 * NO PERSISTENT SUBSCRIPTION NOTICE. The visible line describes the capability,
 * not the plan. The subscription sentence appears only when the customer reaches
 * for it, through the shared Pro toast, so the page keeps exactly one persistent
 * notice (the follow-up control) as the approved UX requires.
 */

/** Row widths, fixed so the teaser renders identically on every lead. */
const SUMMARY_ROWS = ['100%', '92%', '68%']
const INSIGHT_ROWS = ['86%', '78%', '64%']

function Bar({ width, className = '' }: { width: string; className?: string }) {
  return <div aria-hidden className={`h-2.5 rounded-full bg-gray-200/90 ${className}`} style={{ width }} />
}

export default function LeadIntelligenceTeaser() {
  return (
    <section
      aria-label='תקציר חכם, זמין עם Pro'
      className='relative overflow-hidden rounded-lg border border-gray-200 bg-white p-5 mb-8'
    >
      <div className='flex items-center justify-between mb-3'>
        <div className='flex items-center gap-2'>
          <p className='flex items-center gap-1.5 text-xs font-semibold text-gray-500'>
            <Sparkles aria-hidden className='size-3.5 text-accent' />
            תקציר חכם
          </p>
          <span className='rounded-full border border-warning-border bg-warning-bg px-2 py-0.5 text-[11px] font-semibold text-warning-text'>
            Pro
          </span>
        </div>
      </div>

      {/*
        The preview. `select-none` and `aria-hidden` on the bars keep it out of
        the accessibility tree and out of copy/paste: it is decoration standing
        in for content, and it should never be mistaken for either.
      */}
      <div className='relative'>
        <div aria-hidden className='select-none space-y-4 blur-[3px]'>
          <div className='space-y-2'>
            {SUMMARY_ROWS.map((w) => (
              <Bar key={w} width={w} />
            ))}
          </div>

          <div className='space-y-2 pr-5'>
            {INSIGHT_ROWS.map((w) => (
              <Bar key={w} width={w} className='bg-gray-200/75' />
            ))}
          </div>

          <div className='border-r-2 border-info-border pr-3 space-y-2'>
            <div className='flex items-center gap-1.5'>
              <Lightbulb aria-hidden className='size-3.5 text-accent' />
              <Bar width='104px' className='h-2 bg-gray-200/80' />
            </div>
            <Bar width='72%' />
            <Bar width='58%' className='h-2 bg-gray-200/70' />
          </div>
        </div>

        {/*
          Fade the preview into the card rather than cutting it off. Anchored to
          the preview's own box, so it stays correct when the footer below wraps
          onto two lines on a narrow screen.
        */}
        <div
          aria-hidden
          className='pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-white'
        />
      </div>

      <div className='mt-4 flex flex-wrap items-center justify-between gap-3'>
        <p className='text-[13px] leading-snug text-gray-600'>
          התקציר החכם מנתח את הליד ומציע את הצעד הבא.
        </p>
        <button
          type='button'
          onClick={() =>
            proToast({
              title: 'התקציר החכם זמין עם Pro',
              body: 'חידוש המנוי יחזיר את התקציר החכם.',
              source: 'lead_intelligence',
            })
          }
          className='press inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-warning-border bg-warning-bg px-5 text-[13px] font-semibold text-warning-text hover:bg-warning-bg/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-warning-text'
        >
          לצפייה בתקציר
        </button>
      </div>
    </section>
  )
}
