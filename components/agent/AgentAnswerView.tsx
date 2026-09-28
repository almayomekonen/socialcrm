'use client'

import Icon from '@/lib/Icon'
import { ResponseStream } from '@/components/ui/response-stream'
import type { AgentAnswer, Claim } from '@/lib/agent/types'

/**
 * One validated answer.
 *
 * WHAT IT RENDERS IS ALREADY TRUE. Every claim here survived
 * `validateAgentAnswer`, which drops any statement whose evidence the tools did
 * not actually collect. So this component's job is presentation, not
 * verification — and it must not add anything the answer does not contain. No
 * derived counts, no re-ordering that implies priority the agent did not state,
 * no invented links.
 *
 * THE CLASS DRIVES THE WEIGHT, not a colour scheme for its own sake:
 *
 *   FACT / OBSERVATION   what is true right now — plain rows, read as a list
 *   INFERENCE            a reading of the situation — same rows, muted marker
 *   RECOMMENDATION       what to do next — lifted into a card, because it is
 *                        the only class the rep can act on
 *
 * That split is why recommendations are separated out below rather than left in
 * sequence: an answer's value is the action at the end of it, and burying it in
 * a list of statements makes the rep hunt for it. Everything else keeps the
 * agent's own order.
 *
 * `unknown` is rendered whenever it is present, never hidden. An honest "I could
 * not determine X" is the most important line in some answers, and a UI that
 * silently drops it turns a careful answer into an overconfident one.
 *
 * THE PROSE FADES IN WORD BY WORD, and the mode matters. `fade` puts every word
 * in the DOM at once and animates opacity, so the whole answer is readable by a
 * screen reader, selectable and copyable from the first frame — it is a REVEAL.
 * A typewriter would slice a completed string over time, which is the
 * "animated typing of a response that already finished on the server" the
 * experience guidelines name as fake streaming; the Agent's answer is validated
 * in full before a word of it may be shown, so there is nothing left to stream.
 *
 * THE RECOMMENDATION'S CARD IS INSTANT; ITS PROSE IS NOT. The surface, the mark
 * and the space it occupies are painted on the first frame, so nothing below it
 * moves as the answer arrives — and the sentence inside it fades in its turn,
 * last, because an answer that revealed its conclusion before its reasoning
 * would read backwards.
 *
 * This is a narrowing of an earlier rule, not a reversal of one. That rule said
 * recommendations must never fade because interaction must not wait on an
 * animation — true, and it still governs `AgentActionCard`, which has buttons.
 * This card has none: it is a paragraph in a box, and the only thing waiting is
 * reading.
 */

/** Short on purpose: about a second for a long sentence, not a performance. */
const FADE_MS = 340
const WORD_DELAY_MS = 26

/**
 * A pause between blocks, on top of the words each one owes.
 *
 * Without it the reveal is technically sequential and reads as continuous prose
 * running on; a beat at each boundary is what makes the headline land as a
 * headline and each line as its own statement.
 */
const BLOCK_GAP_MS = 90

/**
 * Where a block's own stagger begins, so the answer reads DOWN the page.
 *
 * Every `ResponseStream` starts its stagger at zero, so the headline and every
 * line under it used to reveal their first word in the same frame: the block
 * appeared all at once, which is the "thrown" landing rather than the pass a
 * reader expects from a generated answer.
 *
 * The offset is derived from what is above, not from a fixed step per block, so
 * a long headline holds the line under it for longer than a short one — the
 * cadence follows the prose instead of a metronome.
 *
 * COUNTED THE WAY THE RENDERER COUNTS. `ResponseStream` staggers by SEGMENT and
 * `Intl.Segmenter` emits the spaces as segments too, so words alone would run
 * roughly half as long as the animation actually takes and every block would
 * start before the one above it finished. This is the same whitespace split the
 * component falls back to, which tracks the segmenter closely enough for timing.
 */
function segmentCount(text: string): number {
  return text.split(/(\s+)/).filter(Boolean).length
}

/**
 * BOUNDED, because a long answer must not make its last line wait.
 *
 * Past this the reveal stops being a pass and becomes a queue: the rep is
 * reading the top while the bottom is still hidden for no reason they can see.
 * Blocks beyond the cap simply start together — the pass has already done its
 * work by then.
 */
const MAX_START_DELAY_MS = 1400

/**
 * When each block in a sequence should begin, given the blocks above it.
 *
 * Pure and total: the same list always yields the same schedule, so a re-render
 * cannot shift a delay and restart an animation mid-pass.
 */
function revealSchedule(blocks: readonly string[]): number[] {
  let elapsed = 0
  return blocks.map((text) => {
    const at = Math.min(elapsed, MAX_START_DELAY_MS)
    elapsed += segmentCount(text) * WORD_DELAY_MS + BLOCK_GAP_MS
    return at
  })
}
export default function AgentAnswerView({ answer }: { answer: AgentAnswer }) {
  const statements = answer.claims.filter((c) => c.claimClass !== 'RECOMMENDATION')
  const recommendations = answer.claims.filter((c) => c.claimClass === 'RECOMMENDATION')

  /**
   * The reveal clock, resolved BEFORE the JSX rather than accumulated inside it.
   *
   * An accumulator mutated in render, read from JSX argument positions, is
   * correct only while those expressions are evaluated exactly once and in
   * source order. This app compiles with the React Compiler, which is free to
   * memoize sub-expressions — so the ordering that makes such a counter work is
   * an assumption the build is under no obligation to keep. Computing the whole
   * schedule up front is pure, and each block just reads its own slot.
   *
   * Recommendations are absent from the schedule deliberately: they do not fade
   * (see the header), so they owe the sequence nothing.
   */
  const schedule = revealSchedule([
    answer.headline,
    ...statements.map(claimText),
    ...recommendations.map(claimText),
    ...(answer.unknown ? [answer.unknown] : []),
  ])
  const recStart = 1 + statements.length
  /**
   * The chrome's fade, on its own line's clock.
   *
   * A bullet or a card that is painted before the sentence it belongs to shows
   * the answer's skeleton assembling itself — the reveal reads as a UI building
   * rather than as an answer arriving. Each piece now waits for its own line.
   *
   * Layout is unaffected: the text is in the DOM at full size from the first
   * frame either way, so these elements already occupy their space and only
   * their opacity is animated. Nothing below them moves.
   */
  const revealAt = (delay: number) => ({ '--rs-delay': `${delay}ms`, '--rs-fade-duration': `${FADE_MS}ms` }) as React.CSSProperties
  const unknownDelay = answer.unknown ? (schedule[recStart + recommendations.length] ?? 0) : 0

  return (
    <div className='space-y-3'>
      <ResponseStream
        as='p'
        mode='fade'
        textStream={answer.headline}
        fadeDuration={FADE_MS}
        segmentDelay={WORD_DELAY_MS}
        startDelay={schedule[0] ?? 0}
        className='text-base font-medium leading-7 tracking-[-0.005em] text-ink'
      />

      {statements.length > 0 && (
        <ul className='space-y-1.5'>
          {statements.map((claim, i) => (
            <li key={i} className='flex items-start gap-2.5'>
              <span
                aria-hidden='true'
                style={revealAt(schedule[i + 1] ?? 0)}
                className={`response-stream-reveal mt-[9px] size-1.5 shrink-0 rounded-full ${
                  claim.claimClass === 'INFERENCE' ? 'bg-neutral-dot' : 'bg-accent'
                }`}
              />
              <ResponseStream
                as='span'
                mode='fade'
                textStream={claimText(claim)}
                fadeDuration={FADE_MS}
                segmentDelay={WORD_DELAY_MS}
                startDelay={schedule[i + 1] ?? 0}
                className='text-[15px] leading-6 text-gray-800'
              />
            </li>
          ))}
        </ul>
      )}

      {recommendations.length > 0 && (
        <ul className='space-y-2 pt-0.5'>
          {recommendations.map((claim, i) => (
            <li key={i}>
              {/* An ordinary SocialCRM surface. The recommendation is emphasised
                  by being a card, not by a visual language of its own; the accent
                  on the mark is the system's existing AI highlight. */}
              <article
                style={revealAt(schedule[recStart + i] ?? 0)}
                className='response-stream-reveal flex items-start gap-3 rounded-md border bg-white px-4 py-3.5'
              >
                <span className='mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-tint'>
                  <Icon name='sparkles' type='sol' className='size-3.5 bg-primary' />
                </span>
                <ResponseStream
                  as='p'
                  mode='fade'
                  textStream={claimText(claim)}
                  fadeDuration={FADE_MS}
                  segmentDelay={WORD_DELAY_MS}
                  startDelay={schedule[recStart + i] ?? 0}
                  className='text-[15px] font-medium leading-6 text-ink'
                />
              </article>
            </li>
          ))}
        </ul>
      )}

      {answer.unknown && (
        <ResponseStream
          as='p'
          mode='fade'
          textStream={answer.unknown}
          fadeDuration={FADE_MS}
          segmentDelay={WORD_DELAY_MS}
          startDelay={unknownDelay}
          className='text-sm leading-6 text-gray-600'
        />
      )}
    </div>
  )
}

/** The prose of a claim, whatever its class calls its evidence field. */
function claimText(claim: Claim): string {
  return claim.text
}
