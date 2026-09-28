// @vitest-environment jsdom
//
// TEMPORARY real-device layout probe for /agent (see AgentLayoutProbe.tsx).
// Pins the two things that make it safe to ship to production: who can see it,
// and that it reports geometry only — never text a customer or rep produced.
// Runs without a database: `npm run test:a11y`.

import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { layoutProbeRequested } from '@/lib/agent/layoutProbeGate'
import AgentLayoutProbe, { measureAgentLayout } from '@/components/agent/AgentLayoutProbe'

describe('who sees the probe: explicit parameter AND platform owner', () => {
  const owner = 'alamayo274@gmail.com'
  beforeEach(() => { delete process.env.PLATFORM_OWNER_EMAILS })

  test.each([
    [{ agentdebug: '1' }, owner, true],
    [{}, owner, false],
    [{ agentdebug: '0' }, owner, false],
    [{ agentdebug: ['1', '1'] }, owner, false],
    [{ agentdebug: '1' }, 'customer@example.com', false],
    [{ agentdebug: '1' }, null, false],
    [{ agentdebug: '1' }, undefined, false],
  ])('%j by %s → %s', (params, email, expected) => {
    expect(layoutProbeRequested(params, email)).toBe(expected)
  })

  test('the owner allowlist is the env list when set — the fallback owner is then NOT an owner', () => {
    process.env.PLATFORM_OWNER_EMAILS = 'ops@example.com'
    expect(layoutProbeRequested({ agentdebug: '1' }, owner)).toBe(false)
    expect(layoutProbeRequested({ agentdebug: '1' }, 'ops@example.com')).toBe(true)
  })
})

describe('what the probe reports: geometry, never content', () => {
  const SECRET_DRAFT = 'דני כהן 052-1234567 חייב לנו 5000'
  const LEAD_NAME = 'רונית ישראלי'

  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never
    if (!globalThis.CSS) (globalThis as { CSS?: unknown }).CSS = { supports: () => true }
    else if (!CSS.supports) (CSS as { supports?: unknown }).supports = () => true
    document.body.innerHTML = `
      <div class="col"><div data-mobile-workspace>
        <header data-mobile-header>הסוכן שלך</header>
        <main id="main-content"><div data-mobile-scroll-owner>
          <div data-agent-scroll><p>${LEAD_NAME}</p></div>
          <div data-agent-composer><div class="card">
            <textarea aria-label="שאל את הסוכן"></textarea>
            <button aria-label="שליחה"></button>
          </div></div>
        </div></main>
        <nav>היום</nav>
      </div></div>`
    ;(document.querySelector('textarea') as HTMLTextAreaElement).value = SECRET_DRAFT
  })
  afterEach(() => { cleanup(); document.body.innerHTML = '' })

  test('covers every element the layout depends on', () => {
    const r = measureAgentLayout('abc12345')
    expect(r.build).toBe('abc12345')
    for (const k of ['column', 'shell', 'header', 'main', 'agentRoot', 'content', 'composer', 'card', 'textarea', 'action', 'tabBar'] as const) {
      expect(r.elements[k], k).not.toBeNull()
    }
    expect(r.elements.action?.position).toBeDefined()
    expect(Object.keys(r.viewport)).toEqual(expect.arrayContaining(['innerH', 'vvH', 'clientH', 'safeArea', 'publishedH']))
    expect(Object.keys(r.media)).toEqual(expect.arrayContaining(['pointerCoarse', 'hoverNone', 'standalone']))
  })

  test('no draft text, no lead names, no page text — in the data or on screen', () => {
    const json = JSON.stringify(measureAgentLayout('abc12345'))
    expect(json).not.toContain(SECRET_DRAFT)
    expect(json).not.toContain('052-1234567')
    expect(json).not.toContain(LEAD_NAME)
    const { container } = render(<AgentLayoutProbe build='abc12345' />)
    expect(container.textContent).not.toContain(SECRET_DRAFT)
    expect(container.textContent).not.toContain(LEAD_NAME)
  })
})
