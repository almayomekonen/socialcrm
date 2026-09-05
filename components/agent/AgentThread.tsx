'use client'

import AgentAnswerView from './AgentAnswerView'
import { toolLabel, type AgentUiTurn } from './agentTypes'

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
 */
export default function AgentThread({ turns }: { turns: AgentUiTurn[] }) {
  return (
    <div className='space-y-6 pb-2'>
      {turns.map((turn) =>
        turn.role === 'user' ? (
          <div key={turn.id} className='flex justify-start'>
            <p
              className={[
                'max-w-[85%] rounded-2xl bg-white/12 px-4 py-2.5 ring-1 ring-white/20 backdrop-blur-xl',
                'shadow-[0_1px_2px_rgba(0,0,0,0.15),0_12px_28px_-18px_rgba(0,0,0,0.7)]',
                'text-[15px] leading-6 font-medium text-white',
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
            {turn.status === 'thinking' ? (
              <Thinking tools={turn.tools} />
            ) : turn.status === 'done' ? (
              <AgentAnswerView answer={turn.answer} />
            ) : (
              <p className='text-[15px] leading-6 text-white/70'>{turn.message}</p>
            )}
          </div>
        ),
      )}
    </div>
  )
}

/**
 * The wait, reported honestly.
 *
 * It names the capability actually running — each label arrives from a real tool
 * call the server admitted, not from a timer. Before the first tool returns
 * there is genuinely nothing to report, so it says only that it is working
 * rather than inventing a step it has not taken.
 *
 * `aria-live='polite'` because the row rewrites itself while the rep waits: a
 * screen reader should hear the progress without being interrupted mid-sentence.
 */
function Thinking({ tools }: { tools: string[] }) {
  const label = tools.length ? toolLabel(tools[tools.length - 1]!) : 'חושב על זה'

  return (
    <p className='flex items-center gap-2.5 text-[15px] leading-6 text-white/70' aria-live='polite'>
      <span aria-hidden='true' className='flex gap-1'>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className='size-1.5 animate-pulse rounded-full bg-white/50 motion-reduce:animate-none'
            style={{ animationDelay: `${i * 160}ms`, animationDuration: '1.1s' }}
          />
        ))}
      </span>
      {label}
    </p>
  )
}
