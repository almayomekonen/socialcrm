'use client'

import AgentAnswerView from './AgentAnswerView'
import AgentActionCard from './AgentActionCard'
import AgentBatchCard from './AgentBatchCard'
import { ShiningText } from '@/components/ui/shining-text'
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
export default function AgentThread({
  turns,
  onDecide,
  onDecideBatch,
}: {
  turns: AgentUiTurn[]
  /** Supplied by the workspace; absent in read-only renders (history, tests). */
  onDecide?: (turnId: string, actionId: string, argsHash: string, decision: 'APPROVED' | 'REJECTED') => void
  /** One decision for a whole batch — never one per lead. */
  onDecideBatch?: (turnId: string, planId: string, planHash: string, decision: 'APPROVED' | 'REJECTED') => void
}) {
  return (
    <div className='space-y-6 pb-2'>
      {turns.map((turn) =>
        turn.role === 'user' ? (
          <div key={turn.id} className='flex justify-start'>
            <p
              className={[
                'max-w-[85%] rounded-md border bg-primary-tint px-4 py-2.5',
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
            {turn.status === 'thinking' ? (
              <Thinking tools={turn.tools} />
            ) : turn.status === 'done' ? (
              <div className='space-y-3'>
                <AgentAnswerView answer={turn.answer} />
                {/* Rendered only when the model actually asked to act. The card
                    owns the status; the answer above it owns the reasoning. */}
                {/* One card for the whole set — never one per lead. */}
                {turn.answer.proposedBatch && (
                  <AgentBatchCard
                    batch={turn.answer.proposedBatch}
                    outcome={turn.batchOutcome}
                    pending={turn.actionPending}
                    onDecide={
                      onDecideBatch && turn.batchOutcome?.planId && turn.batchOutcome?.planHash
                        ? (decision) =>
                            onDecideBatch(turn.id, turn.batchOutcome!.planId!, turn.batchOutcome!.planHash!, decision)
                        : undefined
                    }
                  />
                )}
                {turn.answer.proposedAction && (
                  <AgentActionCard
                    proposal={turn.answer.proposedAction}
                    outcome={turn.actionOutcome}
                    pending={turn.actionPending}
                    onDecide={
                      onDecide && turn.actionOutcome?.actionId
                        ? (decision) =>
                            onDecide(turn.id, turn.actionOutcome!.actionId, turn.actionOutcome!.argsHash, decision)
                        : undefined
                    }
                  />
                )}
              </div>
            ) : (
              <p className='text-[15px] leading-6 text-error-text'>{turn.message}</p>
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
 * ONE SIGNAL, NOT TWO. This used to pulse three dots BESIDE the label; the
 * shimmer now carries the same message through the words themselves, so the
 * dots went with it. Two animations saying "still working" is the competing
 * pending state the experience guidelines rule out — and the sweep is the more
 * honest of the two, because it moves across the sentence that is actually
 * changing rather than beside it.
 *
 * The motion is decorative ONLY in the sense that it carries no data; it is not
 * fake progress, because the label under it is always a capability the server
 * really admitted, and it stops the moment the answer arrives.
 *
 * `aria-live='polite'` because the row rewrites itself while the rep waits: a
 * screen reader should hear the progress without being interrupted mid-sentence.
 * The live region stays on this paragraph — `ShiningText` only paints.
 */
function Thinking({ tools }: { tools: string[] }) {
  const label = tools.length ? toolLabel(tools[tools.length - 1]!) : 'חושב על זה'

  return (
    <p className='text-[15px] leading-6' aria-live='polite'>
      {/* Keyed by the label so a new capability restarts the sweep rather than
          continuing mid-pass, which would read as one long unchanging wait. */}
      <ShiningText key={label} text={label} base='var(--color-neutral-text)' highlight='var(--color-ink)' />
    </p>
  )
}

