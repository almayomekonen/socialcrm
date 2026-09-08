// @vitest-environment jsdom
/**
 * The answer's reveal.
 *
 * THE PROPERTY THAT MAKES IT HONEST is that nothing is withheld. The Agent's
 * answer is validated in full server-side before a word of it may be shown, so
 * there is no generation left to stream — animating it out over time would be
 * the "animated typing of a response that already finished on the server" the
 * experience guidelines name as fake streaming.
 *
 * `fade` avoids that by putting every word in the DOM on the first frame and
 * animating only opacity. These tests pin exactly that: the text is complete and
 * selectable immediately, the stagger is CSS, and two answers on screen cannot
 * fight over each other's timings.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ResponseStream } from '@/components/ui/response-stream'
import AgentAnswerView from '@/components/agent/AgentAnswerView'
import type { AgentAnswer } from '@/lib/agent/types'

afterEach(cleanup)

const TEXT = 'יש 25 לידים פתוחים בלי צעד הבא.'

describe('fade mode withholds nothing', () => {
  it('has the COMPLETE text in the DOM on the first frame', () => {
    const { container } = render(<ResponseStream textStream={TEXT} mode='fade' />)
    // No waiting, no timers advanced: every word is already here.
    expect(container.textContent).toBe(TEXT)
  })

  it('animates opacity rather than slicing the string', () => {
    const { container } = render(<ResponseStream textStream={TEXT} mode='fade' fadeDuration={300} />)
    const segments = container.querySelectorAll('.response-stream-segment')
    expect(segments.length).toBeGreaterThan(3)
    // Each word carries its own delay; the reveal is CSS, not JavaScript.
    expect((segments[0] as HTMLElement).style.getPropertyValue('--rs-delay')).toBe('0ms')
    expect((segments[2] as HTMLElement).style.getPropertyValue('--rs-delay')).not.toBe('0ms')
  })

  it('gives each instance its OWN duration', () => {
    /**
     * The defect this guards: the original declared a global `.fade-segment`
     * rule inside a per-instance `<style>` tag, so two answers on screen with
     * different durations fought and the last mount won for both.
     */
    const { container } = render(
      <>
        <ResponseStream textStream='ראשון' mode='fade' fadeDuration={200} />
        <ResponseStream textStream='שני' mode='fade' fadeDuration={900} />
      </>,
    )
    const durations = [...container.querySelectorAll('.response-stream-segment')].map((el) =>
      (el as HTMLElement).style.getPropertyValue('--rs-fade-duration'),
    )
    expect(durations).toContain('200ms')
    expect(durations).toContain('900ms')
  })

  it('preserves whitespace so words do not run together', () => {
    const { container } = render(<ResponseStream textStream='שתי מילים' mode='fade' />)
    expect(container.textContent).toBe('שתי מילים')
    expect(container.querySelector('.response-stream-segment-space')).not.toBeNull()
  })

  it('renders the element it was asked for, not a wrapper div', () => {
    const { container } = render(<ResponseStream as='p' textStream={TEXT} mode='fade' className='x' />)
    const p = container.querySelector('p.x')
    expect(p).not.toBeNull()
    expect(p!.textContent).toBe(TEXT)
  })
})

describe('typewriter is the mode that DOES withhold', () => {
  it('starts empty, which is why the agent must not use it', () => {
    // Kept for a genuine `AsyncIterable`, where the wait is real. Over a
    // completed string it is a simulation of generation.
    const { container } = render(<ResponseStream textStream={TEXT} mode='typewriter' />)
    expect(container.textContent).toBe('')
  })
})

describe('the agent answer uses the honest mode', () => {
  const answer: AgentAnswer = {
    headline: 'כותרת התשובה.',
    claims: [
      { claimClass: 'OBSERVATION', text: 'יש 11 לידים שהתקררו.', metricEvidence: ['health.gone_cold'] },
      { claimClass: 'RECOMMENDATION', text: 'הייתי מתחיל בהם.', evidence: ['lead:1'] },
    ],
    unknown: 'אין נתוני הכנסה.',
    businessState: 'AT_RISK',
  }

  it('shows the whole answer immediately — headline, claims and unknown', () => {
    const { container } = render(<AgentAnswerView answer={answer} />)
    /**
     * Asserted on `textContent` rather than with `getByText`: the reveal splits
     * prose into a span per word, so no single element holds a whole sentence.
     * Within a paragraph those spans are read continuously by a screen reader
     * and select as one run of text — but a query that expects one node will not
     * find them, which is worth knowing before writing the next test here.
     */
    expect(container.textContent).toContain('כותרת התשובה.')
    expect(container.textContent).toContain('יש 11 לידים שהתקררו.')
    expect(container.textContent).toContain('אין נתוני הכנסה.')
  })

  /**
   * REPLACES an earlier rule that said the recommendation must never fade,
   * because interaction must not wait on an animation. That rule was right about
   * `AgentActionCard`, which has buttons, and wrong here: this card is a
   * paragraph in a box with nothing to click, so the only thing waiting is
   * reading — and a conclusion that appeared before its own reasoning read
   * backwards.
   *
   * What replaced it is stricter, not looser: the prose must be revealed AND it
   * must be revealed last.
   */
  it('reveals the recommendation last, after every statement above it', () => {
    const { container } = render(<AgentAnswerView answer={answer} />)

    const firstDelayIn = (node: Element | null | undefined): number => {
      const seg = node?.querySelector('.response-stream-segment') as HTMLElement | null
      return Number.parseInt(seg?.style.getPropertyValue('--rs-delay') ?? '', 10)
    }

    const paragraphs = Array.from(container.querySelectorAll('p'))
    const headline = paragraphs.find((p) => p.textContent?.includes('כותרת התשובה'))
    const recommendation = paragraphs.find((p) => p.textContent?.includes('הייתי מתחיל בהם'))

    // It is revealed — the old rule's opposite.
    expect(recommendation?.querySelector('.response-stream-segment')).not.toBeNull()
    // And it starts after the headline, so the answer reads down the page.
    expect(firstDelayIn(recommendation)).toBeGreaterThan(firstDelayIn(headline))
  })

  it('paints the recommendation CARD immediately, so nothing below it moves', () => {
    const { container } = render(<AgentAnswerView answer={answer} />)
    // The surface and its mark are not gated on the reveal: only the prose is.
    const card = container.querySelector('article')
    expect(card).not.toBeNull()
    expect(card?.className).toContain('bg-white')
    expect(card?.closest('.response-stream-segment')).toBeNull()
  })

  /**
   * THE DEFECT THIS GUARDS. Every `ResponseStream` staggers from zero, so before
   * `startDelay` existed the headline, each claim and the unknown line all began
   * their first word in the same frame: the answer landed as a block instead of
   * running down the page. The property is that each block's FIRST word waits
   * for the blocks above it — not merely that some delay somewhere is non-zero,
   * which was true of the broken version too.
   */
  it('starts each block after the one above it, rather than all at once', () => {
    const { container } = render(<AgentAnswerView answer={answer} />)

    // One entry per revealed block, in document order.
    const blockStarts = Array.from(container.querySelectorAll('p, li span.text-\\[15px\\]'))
      .map((el) => el.querySelector('.response-stream-segment') as HTMLElement | null)
      .filter((seg): seg is HTMLElement => seg !== null)
      .map((seg) => Number.parseInt(seg.style.getPropertyValue('--rs-delay'), 10))

    // headline + one statement + one recommendation + unknown
    expect(blockStarts).toHaveLength(4)
    expect(blockStarts[0]).toBe(0)
    // Strictly increasing: no two blocks may start together.
    for (let i = 1; i < blockStarts.length; i++) {
      expect(blockStarts[i]).toBeGreaterThan(blockStarts[i - 1]!)
    }
  })

  it('never renders a typewriter anywhere in the answer', () => {
    const { container } = render(<AgentAnswerView answer={answer} />)
    // Every reveal on this surface must be opacity-only.
    expect(container.textContent).toContain('כותרת התשובה.')
    expect(container.textContent).toContain('יש 11 לידים שהתקררו.')
  })
})
