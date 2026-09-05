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
        'rounded-2xl bg-white/10 px-4 py-3.5 ring-1 ring-white/20 backdrop-blur-xl',
        'shadow-[0_1px_2px_rgba(0,0,0,0.15),0_12px_28px_-18px_rgba(0,0,0,0.7)]',
        'transition-colors duration-200 motion-reduce:transition-none',
        'hover:bg-white/14 hover:ring-white/30',
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
          <p className='truncate text-base font-semibold text-white'>{card.name}</p>
          {/* Status and state on one line, separated by a middot rather than
              two stacked rows: the card is scanned, not read. */}
          <p className='mt-1 truncate text-sm text-white/65'>
            {card.status} · {card.state}
          </p>
        </div>
        {/* Waiting time is the reason this card is here, so it gets the weight
            of the second-most-important thing on it — not a muted timestamp. */}
        <span className='shrink-0 whitespace-nowrap text-sm font-semibold text-warning'>{card.waiting}</span>
      </div>
    </Shell>
  )
}

function SummaryCard({ card }: { card: Extract<AgentCard, { kind: 'summary' }> }) {
  return (
    <Shell>
      <div className='flex items-start gap-3'>
        <span className='mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/15'>
          <Icon name='comments' type='sol' className='size-4 bg-white' />
        </span>
        <div className='min-w-0'>
          <p className='text-base font-semibold text-white'>{card.title}</p>
          {card.detail && <p className='mt-1 text-sm text-white/65'>{card.detail}</p>}
        </div>
      </div>
    </Shell>
  )
}
