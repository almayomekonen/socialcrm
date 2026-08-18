// @vitest-environment jsdom
//
// Entity separation for the sections that have no phone screen yet.
//
// THE DEFECT THIS SUITE CLOSES. The mobile workspace swaps the SHELL at the
// (app) layout, but each route chooses its own PRESENTATION at its own page. A
// route with no mobile branch therefore inherited half a decision: the phone got
// `MobileWorkspaceShell` wrapped around the desktop table. That is the tree
// architecture-rules.md §9 forbids — and CSS cannot fix it, because the desktop
// markup is already in the phone's HTML by the time any stylesheet runs.
//
// Guarantees locked in (do not weaken):
//   8.  A phone screen never renders desktop navigation.
//   9.  The desktop shell is never rendered inside the mobile workspace.
//   10. Every desktop-only section renders the handoff, not a table or a grid.
//   11. Nothing is dual-rendered and hidden with CSS — absence, not suppression.
//
// No DB: `npm run test:a11y` (VITEST_NO_DB=1).

import { describe, afterEach, test, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'

let pathname = '/tasks'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, back: () => {} }),
  usePathname: () => pathname,
}))

import MobileWorkspaceShell from '@/components/mobile/MobileWorkspaceShell'
import MobileDesktopOnly from '@/components/mobile/MobileDesktopOnly'
import {
  DESKTOP_ONLY_LEAD,
  DESKTOP_ONLY_SECTIONS,
  DESKTOP_ONLY_ROUTES,
  MOBILE_READY_ROUTES,
  type DesktopOnlySection,
} from '@/lib/mobile/desktopOnlyRoutes'
import { MOBILE_HANDOFF_COPY } from '@/lib/activation/mobileHandoffCopy'

afterEach(() => {
  cleanup()
  pathname = '/tasks'
})

const SECTIONS = Object.keys(DESKTOP_ONLY_SECTIONS) as DesktopOnlySection[]

/** The whole point: the handoff is rendered INSIDE the real mobile workspace. */
function renderInShell(section: DesktopOnlySection) {
  pathname = DESKTOP_ONLY_ROUTES[section].path
  return render(
    <MobileWorkspaceShell>
      <MobileDesktopOnly section={section} />
    </MobileWorkspaceShell>,
  )
}

describe('10. every desktop-only section renders a real handoff screen', () => {
  test.each(SECTIONS)('%s states what it is, that it works, and where it lives', (section) => {
    const entry = DESKTOP_ONLY_SECTIONS[section]
    renderInShell(section)

    // Named, so the user knows they reached the right place — not a generic
    // "unavailable" wall that could be about anything.
    expect(screen.getByRole('heading', { name: entry.title })).toBeTruthy()

    // The first thing read answers the only question being asked: is this broken?
    expect(screen.getByText(entry.body).textContent).toContain(DESKTOP_ONLY_LEAD)

    // …and the body goes on to say what the section DOES, so the capability
    // reads as existing rather than missing. Never a bare one-liner.
    expect(entry.body.length).toBeGreaterThan(DESKTOP_ONLY_LEAD.length + 20)
  })

  test.each(SECTIONS)('%s offers a real, working action — never a dead end', (section) => {
    renderInShell(section)
    const cta = screen.getByRole('button', { name: MOBILE_HANDOFF_COPY.copyLabel })
    expect(cta).toBeTruthy()
    expect((cta as HTMLButtonElement).disabled).toBe(false)
    // The address is also stated as text, so the handoff survives a clipboard
    // that refuses. Three affordances, never zero.
    expect(screen.getByText(/getsocialcrm\.com/)).toBeTruthy()
  })

  test.each(SECTIONS)('%s renders NO desktop table or grid underneath', (section) => {
    const { container } = renderInShell(section)
    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelectorAll('[role="grid"]')).toHaveLength(0)
    expect(container.querySelectorAll('[role="table"]')).toHaveLength(0)
  })
})

describe('8 + 9. entity separation', () => {
  test.each(SECTIONS)('%s: phone renders the mobile tab bar and NO desktop navigation', (section) => {
    const { container } = renderInShell(section)

    // The desktop Nav renders a `popover` drawer with this id. Its absence is
    // the proof that the two shells are mutually exclusive rather than layered.
    expect(container.querySelector('#navPop')).toBeNull()

    // Exactly one navigation landmark, and it is the mobile one. Two would mean
    // both shells mounted — the failure this suite exists to catch.
    expect(screen.getAllByRole('navigation')).toHaveLength(1)
    expect(screen.getByRole('navigation', { name: 'ניווט ראשי' })).toBeTruthy()
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  test('the handoff is a mobile presentation, not the desktop page in a smaller box', () => {
    const { container } = renderInShell('tasks')
    // It renders through the mobile workspace's own handoff primitive, so it
    // inherits mobile spacing and touch targets rather than inventing a look.
    expect(container.querySelector('[data-mobile-workspace]')).not.toBeNull()
  })
})

describe('11. no CSS-based dual-shell rendering', () => {
  test.each(SECTIONS)('%s ships no responsive-hiding classes anywhere in the tree', (section) => {
    const { container } = renderInShell(section)
    const html = container.innerHTML

    // `desktop:hidden` / `hidden desktop:block` are how the DESKTOP shell
    // toggles its own chrome. Either appearing inside the mobile workspace would
    // mean something was rendered for both entities and suppressed for one —
    // the race architecture-rules.md §9 rules out, because a z-indexed element
    // can paint before the stylesheet suppresses it.
    expect(html).not.toContain('desktop:hidden')
    expect(html).not.toContain('desktop:block')

    // Nothing is shipped inert either: no `hidden` attribute, no display:none.
    expect(container.querySelectorAll('[hidden]')).toHaveLength(0)
    expect(html).not.toContain('display:none')
    expect(html).not.toContain('display: none')
  })
})

describe('the desktop-only ledger is honest', () => {
  test('every section has a route, and every route has a section', () => {
    expect(Object.keys(DESKTOP_ONLY_ROUTES).sort()).toEqual(SECTIONS.slice().sort())
  })

  test('/clients is EXACT — the lead-detail route must never be handed off', () => {
    // `/clients/[clientId]/summary` is a fully built mobile screen. A prefix
    // match here would hand off the one route on this list that must not be.
    expect(DESKTOP_ONLY_ROUTES.clients).toEqual({ path: '/clients', exact: true })
    expect(MOBILE_READY_ROUTES['/clients/[clientId]/summary']).toBeTruthy()
  })

  test('the lead-detail TABS are desktop-only, but summary is not', () => {
    // The nested gap: /clients/[clientId]/{tasks,files,billing} were rendering
    // desktop tables inside the phone shell when reached by direct URL.
    const paths = Object.values(DESKTOP_ONLY_ROUTES).map((r) => r.path)
    expect(paths).toContain('/clients/[clientId]/tasks')
    expect(paths).toContain('/clients/[clientId]/files')
    expect(paths).toContain('/clients/[clientId]/billing')
    expect(paths).not.toContain('/clients/[clientId]/summary')
  })

  test('/notifications is NOT handed off — it already has a usable mobile list', () => {
    // §5: a Mobile Tab Bar destination. Replacing a working list with "this is
    // on the computer" would remove a mobile screen and leave a tab going
    // nowhere.
    expect(Object.values(DESKTOP_ONLY_ROUTES).map((r) => r.path)).not.toContain('/notifications')
    expect(MOBILE_READY_ROUTES['/notifications']).toBeTruthy()
  })

  test('copy obeys the product terminology rules', () => {
    for (const section of SECTIONS) {
      const { title, body } = DESKTOP_ONLY_SECTIONS[section]
      const text = `${title} ${body}`
      // ux-guidelines.md §6 / CLAUDE.md Entity Constraint: one entity, the ליד.
      expect(text, section).not.toMatch(/לקוח/)
      expect(text, section).not.toMatch(/סוכן/)
      // CLAUDE.md §12: no emoji in UI.
      expect(text, section).not.toMatch(/\p{Extended_Pictographic}/u)
      // Never an apology, never "not supported".
      expect(text, section).not.toMatch(/סליחה|מצטער|לא נתמך|לא זמין במובייל/)
    }
  })
})
