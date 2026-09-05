import Icon from '@/lib/Icon'
import type { AgentCard } from './agentMockData'

/**
 * The cards an agent answer can attach beneath its text.
 *
 * PRESENTATION ONLY — these render a card, they do not fetch, navigate or act.
 * They are deliberately NOT links and carry no chevron: every record shown here
 * is sample data (see `agentMockData`), so an affordance promising "tap to open
 * this lead" would lead nowhere. The chevron and the `href` arrive together, in
 * the change that gives the cards real leads to point at — a navigation promise
 * the UI cannot keep is the fake affordance this project's guidelines forbid.
 *
 * Solid white on the gradient canvas, not a translucent tile: a card carrying
 * names and durations has to stay legible over every band the canvas passes
 * through, and frosted glass is for chrome, not for records.
 *
 * Server Component: no state, no handlers, nothing to hydrate.
 */
export default function AgentCards({ cards }: { cards: AgentCard[] }) {
  return (
    <ul className='mt-3 space-y-2'>
      {cards.map((card) => (
        <li key={card.id}>{card.kind === 'lead' ? <LeadCard card={card} /> : <SummaryCard card={card} />}</li>
      ))}
    </ul>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <article
      className={[
        'rounded-2xl bg-white/95 px-4 py-3.5 ring-1 ring-white/60 backdrop-blur-xl',
        'shadow-[0_1px_2px_rgba(10,37,64,0.06),0_10px_24px_-16px_rgba(10,37,64,0.5)]',
        'transition-shadow duration-200 motion-reduce:transition-none',
        'hover:shadow-[0_2px_4px_rgba(10,37,64,0.08),0_16px_32px_-16px_rgba(10,37,64,0.6)]',
      ].join(' ')}
    >
      {children}
    </article>
  )
}

function LeadCard({ card }: { card: Extract<AgentCard, { kind: 'lead' }> }) {
  return (
    <Shell>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <p className='truncate text-[15px] font-semibold text-ink'>{card.name}</p>
          {/* Status and state on one line, separated by a middot rather than
              two stacked rows: the card is scanned, not read. */}
          <p className='mt-0.5 truncate text-[13px] text-gray-500'>
            {card.status} · {card.state}
          </p>
        </div>
        {/* Waiting time is the reason this card is here, so it gets the weight
            of the second-most-important thing on it — not a muted timestamp. */}
        <span className='shrink-0 whitespace-nowrap text-[13px] font-semibold text-warning-text'>{card.waiting}</span>
      </div>
    </Shell>
  )
}

function SummaryCard({ card }: { card: Extract<AgentCard, { kind: 'summary' }> }) {
  return (
    <Shell>
      <div className='flex items-start gap-3'>
        <span className='mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-tint'>
          <Icon name='comments' type='sol' className='size-4 bg-primary' />
        </span>
        <div className='min-w-0'>
          <p className='text-[15px] font-semibold text-ink'>{card.title}</p>
          {card.detail && <p className='mt-0.5 text-[13px] text-gray-500'>{card.detail}</p>}
        </div>
      </div>
    </Shell>
  )
}
