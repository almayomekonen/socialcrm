'use client'

import AgentCards from './AgentCards'
import type { AgentTurn } from './agentMockData'

/**
 * The conversation.
 *
 * ASYMMETRIC ON PURPOSE. What the user said is a short solid bubble at the
 * inline start; what the agent answered is text across the column. Two facing
 * bubbles would make the answer look like chat chatter — this surface's answers
 * are meant to be read as the product's own output, the way the briefing is.
 *
 * SIDE MATCHES THE INBOX. `justify-start` puts what the user said at the inline
 * start — the visual right in Hebrew — which is exactly where
 * `MessageBubbleMobile` puts an outbound WhatsApp message. A rep who sees their
 * own words on the right in שיחות and on the left here would be reading two
 * different products; the shared rule is worth more than either preference.
 * Logical classes throughout, never `right`/`left`.
 *
 * Ink text, because the gradient canvas behind it is too light for white.
 */
export default function AgentThread({ turns }: { turns: AgentTurn[] }) {
  return (
    <div className='space-y-6 pb-2'>
      {turns.map((turn) =>
        turn.role === 'user' ? (
          <div key={turn.id} className='flex justify-start'>
            <p
              className={[
                'max-w-[85%] rounded-2xl bg-white/95 px-4 py-2.5 ring-1 ring-white/60 backdrop-blur-xl',
                'shadow-[0_1px_2px_rgba(10,37,64,0.06),0_10px_24px_-16px_rgba(10,37,64,0.5)]',
                'text-[15px] leading-6 font-medium text-ink',
                'animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none',
              ].join(' ')}
            >
              {turn.text}
            </p>
          </div>
        ) : (
          <div
            key={turn.id}
            className='animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none'
          >
            <p className='text-[15px] font-medium leading-7 tracking-[-0.005em] text-ink'>{turn.text}</p>
            {turn.cards && turn.cards.length > 0 && <AgentCards cards={turn.cards} />}
          </div>
        ),
      )}
    </div>
  )
}
