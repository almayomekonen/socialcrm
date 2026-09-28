// @vitest-environment jsdom
//
// REGRESSION — /agent on a real iPhone: the send/mic button escaped the input
// and sat on the placeholder, and the composer covered the suggestions.
//
// WHAT THESE TESTS ARE AND ARE NOT. jsdom is not WebKit, applies no stylesheet
// and has no `(pointer: coarse)`, so nothing here proves the layout. The proof
// was measured in WebKit and Chromium with touch emulation at real Safari
// visible heights (375×548, 393×659), before and after:
//
//   before   action button position=relative, 7px above and 7px outside the
//            input, over the placeholder text; sticky composer block 139px,
//            3 of 4 suggestions painted underneath it
//   after    position=absolute, inside the input, clear of the text in every
//            state (empty, typing, recording, transcribing, keyboard-height);
//            one scroller (the agent content); composer below it, above the
//            tab bar; document never scrolls
//
// ROOT CAUSE. `.tap-44 { position: relative }` was unlayered CSS inside
// `@media (pointer: coarse)`. Unlayered CSS beats every Tailwind utility, so on
// touch devices ONLY it overrode `absolute`. Desktop and viewport-only emulation
// never match `pointer: coarse` — which is why it passed everywhere but a phone.
//
// These tests lock the contract that measurement validated. They are a
// tripwire, not the evidence. Runs without a database: `npm run test:a11y`.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postcss, { type AtRule, type Node } from 'postcss'
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

const conversation = vi.hoisted(() => ({ turns: [] as unknown[] }))
vi.mock('@/components/agent/useAgentConversation', () => ({
  useAgentConversation: () => ({
    turns: conversation.turns,
    busy: false,
    ask: vi.fn(),
    reset: vi.fn(),
    decide: vi.fn(),
    decideBatch: vi.fn(),
  }),
}))
vi.mock('@/components/agent/AgentThread', () => ({ default: () => <div data-testid='thread' /> }))
vi.mock('@/components/agent/AgentIntro', () => ({ default: () => <div data-testid='intro' /> }))

import AgentWorkspace from '@/components/agent/AgentWorkspace'

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const tokens = (el: Element) => el.className.split(/\s+/)

function insideLayer(node: Node): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === 'atrule' && (p as AtRule).name === 'layer') return true
  }
  return false
}

describe('touch-target utility never overrides positioning (the root cause)', () => {
  const root = postcss.parse(src('lib/css/main.css'))

  test('`.tap-44` sets position only inside a cascade layer, so `absolute`/`fixed`/`sticky` utilities win', () => {
    const positioned: Node[] = []
    root.walkRules((rule) => {
      if (!rule.selectors.includes('.tap-44')) return
      rule.walkDecls('position', (d) => void positioned.push(d))
    })
    expect(positioned.length).toBeGreaterThan(0)
    for (const decl of positioned) expect(insideLayer(decl), 'unlayered .tap-44 position beats every utility').toBe(true)
  })

  test('the 44px hit area itself is unchanged, and still touch-only', () => {
    let hitArea = false
    root.walkRules('.tap-44::after', (rule) => {
      const media = rule.parent as AtRule
      expect(media.type === 'atrule' && media.name === 'media' && media.params.includes('pointer: coarse')).toBe(true)
      rule.walkDecls('width', (d) => void expect(d.value).toBe('max(100%, 44px)'))
      hitArea = true
    })
    expect(hitArea).toBe(true)
  })

  test('the /agent action button is the combination that exposed it: tap-44 + absolute', () => {
    const control = src('components/agent/AgentSendControl.tsx')
    expect(control).toMatch(/'tap-44 absolute bottom-2 end-2/)
  })
})

describe('mobile shell: a page may own its scrolling without hiding the header', () => {
  test('`data-mobile-scroll-owner` turns `main` into a non-scrolling column', () => {
    const shell = src('components/mobile/MobileWorkspaceShell.tsx')
    expect(shell).toContain('has-[[data-mobile-scroll-owner]]:[&_#main-content]:overflow-hidden')
    expect(shell).toContain('has-[[data-mobile-scroll-owner]]:[&_#main-content]:overscroll-auto')
    // Unlike the WhatsApp thread, the header stays.
    expect(shell).not.toContain('has-[[data-mobile-scroll-owner]]:[&_[data-mobile-header]]:hidden')
  })
})

describe('/agent layout: header → one scroller → composer → tab bar', () => {
  beforeEach(() => {
    conversation.turns = []
    Element.prototype.scrollIntoView = vi.fn()
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never
  })
  afterEach(cleanup)

  const mount = () =>
    render(
      <div data-mobile-workspace>
        <AgentWorkspace />
      </div>,
    )

  test('the workspace opts into owning its scroll', () => {
    const { container } = mount()
    expect(container.querySelector('[data-mobile-scroll-owner]')).not.toBeNull()
  })

  test('exactly one content scroller, and the composer is OUTSIDE it (never scrolls under it)', () => {
    const { container } = mount()
    const scrollers = container.querySelectorAll('[data-agent-scroll]')
    const composer = container.querySelector('[data-agent-composer]')!
    expect(scrollers).toHaveLength(1)
    expect(scrollers[0].contains(composer)).toBe(false)
    expect(scrollers[0].nextElementSibling).toBe(composer)
    expect(scrollers[0].contains(container.querySelector('[data-testid="intro"]'))).toBe(true)
  })

  test('mobile rules are keyed to the mobile SHELL, never to a width breakpoint', () => {
    const { container } = mount()
    const scroller = container.querySelector('[data-agent-scroll]')!
    const composer = container.querySelector('[data-agent-composer]')!
    for (const t of ['in-[[data-mobile-workspace]]:flex', 'in-[[data-mobile-workspace]]:flex-1', 'in-[[data-mobile-workspace]]:min-h-0', 'in-[[data-mobile-workspace]]:overflow-y-auto']) {
      expect(tokens(scroller)).toContain(t)
    }
    expect(tokens(composer)).toContain('in-[[data-mobile-workspace]]:static')
    expect(tokens(composer)).toContain('in-[[data-mobile-workspace]]:shrink-0')
    const file = src('components/agent/AgentWorkspace.tsx')
    expect(file).not.toMatch(/max-desktop:|max-(sm|md|lg):/)
  })

  test('desktop is untouched: sticky composer plinth, and the new wrapper has no box', () => {
    const { container } = mount()
    const scroller = container.querySelector('[data-agent-scroll]')!
    const composer = container.querySelector('[data-agent-composer]')!
    expect(tokens(scroller)).toContain('contents')
    for (const t of ['sticky', 'bottom-0', 'z-10', 'bg-gray', 'pt-10']) expect(tokens(composer)).toContain(t)
    const root = container.querySelector('[data-mobile-scroll-owner]')!
    for (const t of ['flex', 'min-h-full', 'flex-1', 'flex-col']) expect(tokens(root)).toContain(t)
  })
})

describe('/agent keeps the latest answer in view when the content region shrinks', () => {
  let resize: (() => void) | null = null
  beforeEach(() => {
    resize = null
    Element.prototype.scrollIntoView = vi.fn()
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) { resize = cb }
      observe() {}
      disconnect() {}
      unobserve() {}
    } as never
  })
  afterEach(cleanup)

  function mountAt({ started, atEnd }: { started: boolean; atEnd: boolean }) {
    conversation.turns = started ? [{ id: 't1' }] : []
    const { container } = render(
      <div data-mobile-workspace>
        <AgentWorkspace />
      </div>,
    )
    const el = container.querySelector('[data-agent-scroll]') as HTMLDivElement
    Object.defineProperty(el, 'scrollHeight', { value: 900, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 400, configurable: true })
    el.scrollTop = atEnd ? 500 : 120
    act(() => void el.dispatchEvent(new Event('scroll')))
    return el
  }

  test('reading the end + keyboard/composer shrinks the region → still at the end', () => {
    const el = mountAt({ started: true, atEnd: true })
    Object.defineProperty(el, 'clientHeight', { value: 250, configurable: true })
    act(() => resize!())
    expect(el.scrollTop).toBe(900)
  })

  test('scrolled up to read history → a resize never yanks the reader down', () => {
    const el = mountAt({ started: true, atEnd: false })
    act(() => resize!())
    expect(el.scrollTop).toBe(120)
  })

  test('empty (intro) state → no anchoring', () => {
    const el = mountAt({ started: false, atEnd: true })
    el.scrollTop = 0
    act(() => resize!())
    expect(el.scrollTop).toBe(0)
  })
})
