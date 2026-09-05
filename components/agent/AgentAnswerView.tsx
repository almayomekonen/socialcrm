'use client'

import Icon from '@/lib/Icon'
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
 */
export default function AgentAnswerView({ answer }: { answer: AgentAnswer }) {
  const statements = answer.claims.filter((c) => c.claimClass !== 'RECOMMENDATION')
  const recommendations = answer.claims.filter((c) => c.claimClass === 'RECOMMENDATION')

  return (
    <div className='space-y-3'>
      <p className='text-base font-medium leading-7 tracking-[-0.005em] text-white'>{answer.headline}</p>

      {statements.length > 0 && (
        <ul className='space-y-1.5'>
          {statements.map((claim, i) => (
            <li key={i} className='flex items-start gap-2.5'>
              <span
                aria-hidden='true'
                className={`mt-[9px] size-1.5 shrink-0 rounded-full ${
                  claim.claimClass === 'INFERENCE' ? 'bg-white/35' : 'bg-accent'
                }`}
              />
              <span className='text-[15px] leading-6 text-white/85'>{claimText(claim)}</span>
            </li>
          ))}
        </ul>
      )}

      {recommendations.length > 0 && (
        <ul className='space-y-2 pt-0.5'>
          {recommendations.map((claim, i) => (
            <li key={i}>
              {/* Same glass card the rest of the surface uses — the recommendation
                  is emphasised by being a surface, not by a new visual language. */}
              <article
                className={[
                  'flex items-start gap-3 rounded-2xl bg-white/10 px-4 py-3.5 ring-1 ring-white/20 backdrop-blur-xl',
                  'shadow-[0_1px_2px_rgba(0,0,0,0.15),0_12px_28px_-18px_rgba(0,0,0,0.7)]',
                ].join(' ')}
              >
                <span className='mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/15'>
                  <Icon name='sparkles' type='sol' className='size-3.5 bg-white' />
                </span>
                <p className='text-[15px] font-medium leading-6 text-white'>{claimText(claim)}</p>
              </article>
            </li>
          ))}
        </ul>
      )}

      {answer.unknown && (
        <p className='text-sm leading-6 text-white/60'>{answer.unknown}</p>
      )}
    </div>
  )
}

/** The prose of a claim, whatever its class calls its evidence field. */
function claimText(claim: Claim): string {
  return claim.text
}
