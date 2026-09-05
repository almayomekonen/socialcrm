'use client'

import AgentCards from './AgentCards'
import type { AgentTurn } from './agentMockData'

/**
 * The conversation.
 *
 * ASYMMETRIC ON PURPOSE. What the user said is a short bubble at the inline end;
 * what the agent answered is plain text across the column. Two facing bubbles
 * would make the answer look like chat chatter — this surface's answers are
 * meant to be read as the product's own output, the way the briefing is.
 *
 * SIDE MATCHES THE INBOX. `justify-start` puts what the user said at the inline
 * start — the visual right in Hebrew — which is exactly where
 * `MessageBubbleMobile` puts an outbound WhatsApp message. A rep who sees their
 * own words on the right in שיחות and on the left here would be reading two
 * different products; the shared rule is worth more than either preference.
 * Logical classes throughout, never `right`/`left`.
 */
export default function AgentThread({ turns }: { turns: AgentTurn[] }) {
  return (
    <div className='space-y-6'>
      {turns.map((turn) =>
        turn.role === 'user' ? (
          <div key={turn.id} className='flex justify-start'>
            <p
              className={[
                'max-w-[85%] rounded-2xl bg-primary-tint px-4 py-2.5',
                'text-[15px] leading-6 text-gray-900',
                'animate-in fade-in-0 slide-in-from-bottom-2 duration-200 motion-reduce:animate-none',
              ].join(' ')}
            >
              {turn.text}
            </p>
          </div>
        ) : (
          <div
            key={turn.id}
            className='animate-in fade-in-0 slide-in-from-bottom-2 duration-300 motion-reduce:animate-none'
          >
            <p className='text-[15px] leading-7 text-gray-800'>{turn.text}</p>
            {turn.cards && turn.cards.length > 0 && <AgentCards cards={turn.cards} />}
          </div>
        ),
      )}
    </div>
  )
}
