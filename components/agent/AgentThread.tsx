'use client'

import AgentAnswerView from './AgentAnswerView'
import AgentActionCard from './AgentActionCard'
import AgentBatchCard from './AgentBatchCard'
import { ShiningText } from '@/components/ui/shining-text'
import { Pulse } from '@/components/mobile/skeletons/Pulse'
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
 * The wait, reported honestly — and shaped like the answer it is becoming.
 *
 * It names the capability actually running: each label arrives from a real tool
 * call the server admitted, not from a timer. Before the first tool returns
 * there is genuinely nothing to report, so it says only that it is working
 * rather than inventing a step it has not taken.
 *
 * IT MIRRORS `AgentAnswerView`, deliberately. Same `space-y-3` column, the label
 * in the headline's own type and slot, then placeholder rows on the claim list's
 * exact geometry — `space-y-1.5`, `gap-2.5`, a `size-1.5` dot at `mt-[9px]`. The
 * answer therefore RESOLVES INTO this block instead of replacing it, and the
 * thread does not jump when it arrives. A single shimmering line on a page this
 * empty read as a stalled screen; the same line above the shape of the reply
 * reads as one forming.
 *
 * ONE MOVING SIGNAL, STILL. The dots beside the label went when the shimmer
 * arrived — two animations saying "still working" is the competing pending state
 * the experience guidelines rule out. The placeholders do not reintroduce one:
 * `Pulse` is the product's own skeleton primitive, the same neutral
 * `bg-gray-100` breathing used by every route skeleton in the app, and it reads
 * as absence rather than as a second progress report.
 *
 * THE ACCENT IS IDENTITY, NOT ACTIVITY. The first dot is `--color-accent`, which
 * this design system defines as its AI / selection highlight and which the real
 * claims below will use in the same place. It is static, one element, and it is
 * what makes the wait read as the AGENT working rather than as a generic list
 * loading — no orb, no glow, no second palette.
 *
 * `aria-live='polite'` because the row rewrites itself while the rep waits: a
 * screen reader should hear the progress without being interrupted mid-sentence.
 * The live region stays on the label — `ShiningText` only paints — and the
 * placeholders are `aria-hidden`, because announcing four empty bars would tell
 * a screen-reader user nothing they can act on.
 */
function Thinking({ tools }: { tools: string[] }) {
  const label = tools.length ? toolLabel(tools[tools.length - 1]!) : 'חושב על זה'

  return (
    <div className='space-y-3' aria-busy='true'>
      <p className='text-base font-medium leading-7 tracking-[-0.005em]' aria-live='polite'>
        {/* Keyed by the label so a new capability restarts the sweep rather than
            continuing mid-pass, which would read as one long unchanging wait. */}
        <ShiningText key={label} text={label} base='var(--color-neutral-text)' highlight='var(--color-ink)' />
      </p>

      {/* The claim list's shape, before there are claims. Widths descend so the
          block reads as prose rather than as a table. */}
      <ul className='space-y-1.5' aria-hidden='true'>
        {['w-[82%]', 'w-[68%]', 'w-[74%]'].map((w, i) => (
          <li key={w} className='flex items-start gap-2.5'>
            <span className={`mt-[9px] size-1.5 shrink-0 rounded-full ${i === 0 ? 'bg-accent' : 'bg-neutral-dot'}`} />
            <Pulse className={`h-4 rounded ${w}`} />
          </li>
        ))}
      </ul>
    </div>
  )
}

