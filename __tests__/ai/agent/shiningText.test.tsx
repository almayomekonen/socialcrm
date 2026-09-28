// @vitest-environment jsdom
/**
 * The waiting indicator.
 *
 * A shimmer over a loading label is the one place motion earns its keep: the
 * wait has no knowable duration, so movement says "still working" better than
 * any wording can. That also makes it the easiest thing in the product to get
 * subtly wrong — a loop that keeps running over stale text is fake progress, a
 * gradient painted through text disappears in high contrast, and a heading
 * element dropped into a chat thread quietly corrupts the document outline.
 *
 * These pin the three that a screenshot would never catch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const useReducedMotion = vi.hoisted(() => vi.fn(() => false))

vi.mock('motion/react', async () => {
  const React = await import('react')
  return {
    useReducedMotion,
    // A passthrough that keeps the props the component sets, so the gradient and
    // the sweep are inspectable without running an animation frame.
    motion: new Proxy(
      {},
      {
        get: (_t, tag: string) =>
          function Mock({ children, initial, animate, transition, ...rest }: Record<string, unknown> & { children?: unknown }) {
            return React.createElement(
              tag,
              {
                ...rest,
                'data-initial': JSON.stringify(initial),
                'data-animate': JSON.stringify(animate),
                'data-transition': JSON.stringify(transition),
              },
              children as never,
            )
          },
      },
    ),
  }
})

import { ShiningText } from '@/components/ui/shining-text'
import AgentThread from '@/components/agent/AgentThread'

afterEach(() => {
  cleanup()
  useReducedMotion.mockReturnValue(false)
})

describe('ShiningText', () => {
  it('renders the label it was given', () => {
    render(<ShiningText text='בודק את הנתונים' />)
    expect(screen.getByText('בודק את הנתונים')).toBeTruthy()
  })

  it('is not a heading — a chat row must not enter the document outline', () => {
    render(<ShiningText text='חושב על זה' />)
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.getByText('חושב על זה').tagName).toBe('SPAN')
  })

  it('sweeps right-to-left, following the reading direction of a Hebrew product', () => {
    render(<ShiningText text='חושב' />)
    const el = screen.getByText('חושב')
    // A highlight travelling against the reading direction reads as scrubbing
    // backwards over the words rather than moving through them.
    expect(JSON.parse(el.getAttribute('data-initial')!)).toEqual({ backgroundPosition: '-200% 0' })
    expect(JSON.parse(el.getAttribute('data-animate')!)).toEqual({ backgroundPosition: '200% 0' })
  })

  it('loops forever, because the wait has no knowable length', () => {
    render(<ShiningText text='חושב' />)
    const t = JSON.parse(screen.getByText('חושב').getAttribute('data-transition')!)
    expect(t.repeat).toBe(null) // Infinity does not survive JSON; null is what it becomes
    expect(t.ease).toBe('linear')
  })

  it('takes its colours from the caller, not from a hardcoded grey', () => {
    // The original hardcoded #404040, which is muddy on anything but neutral
    // dark — and the agent canvas is navy.
    render(<ShiningText text='חושב' base='rgba(1,2,3,0.5)' highlight='#abcdef' />)
    // jsdom re-serialises colours, so compare with whitespace removed.
    const style = (screen.getByText('חושב').getAttribute('style') ?? '').replace(/\s+/g, '')
    expect(style).toContain('rgba(1,2,3,0.5)')
    // jsdom normalises hex to rgb(), so assert the colour it resolves to.
    expect(style).toContain('rgb(171,205,239)')
    // And the default grey the original hardcoded is gone.
    // And the default grey the original hardcoded — rgb(64,64,64) — is gone.
    expect(style).not.toContain('rgb(64,64,64)')
  })

  it('drops the gradient in forced-colors, so the text cannot vanish', () => {
    render(<ShiningText text='חושב' />)
    const cls = screen.getByText('חושב').getAttribute('class') ?? ''
    expect(cls).toContain('forced-colors:bg-none')
    expect(cls).toContain('forced-colors:text-[CanvasText]')
  })

  it('does not animate at all when the viewer asked for less motion', () => {
    useReducedMotion.mockReturnValue(true)
    render(<ShiningText text='חושב' />)
    const el = screen.getByText('חושב')
    // A perpetual loop is exactly what the setting exists to switch off — and
    // the label stays fully legible rather than being painted through a
    // background that is no longer moving.
    expect(el.getAttribute('data-animate')).toBeNull()
    expect(el.getAttribute('class') ?? '').not.toContain('text-transparent')
  })
})

describe('the agent thinking row', () => {
  const thinking = [{ id: 't1', role: 'agent' as const, status: 'thinking' as const, tools: ['get_lead_health'] }]

  it('shimmers the capability that is actually running', () => {
    render(<AgentThread turns={thinking} />)
    expect(screen.getByText('בודק את מצב ספר הלידים')).toBeTruthy()
  })

  it('keeps the live region on the row, not on the painted text', () => {
    const { container } = render(<AgentThread turns={thinking} />)
    const live = container.querySelector('[aria-live="polite"]')
    expect(live).not.toBeNull()
    expect(live!.tagName).toBe('P')
  })

  it('shows ONE pending signal — the dots went with the shimmer', () => {
    const { container } = render(<AgentThread turns={thinking} />)
    // Two animations both saying "still working" is the competing pending state
    // the experience guidelines rule out.
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0)
  })

  it('says only that it is working before any tool has reported', () => {
    render(<AgentThread turns={[{ id: 't2', role: 'agent', status: 'thinking', tools: [] }]} />)
    expect(screen.getByText('חושב על זה')).toBeTruthy()
  })
})
