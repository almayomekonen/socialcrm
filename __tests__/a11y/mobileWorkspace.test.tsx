// @vitest-environment jsdom
//
// Accessibility + structure regression suite for the Phase 2 mobile workspace.
//
// This is the first surface a phone actually reaches, so its landmarks and
// headings ARE the navigation for a screen-reader user. Assertions query the
// COMPUTED accessibility tree (getByRole uses dom-accessibility-api, the same
// accessible-name algorithm a screen reader applies).
//
// Guarantees locked in (do not weaken without an accessibility review):
//   1. The shell exposes exactly one main landmark and one nav landmark, and
//      never mounts the desktop navigation alongside them.
//   2. A tab screen shows no back control; a non-tab screen does.
//   3. Today renders one h1 (from the shell) and section headings below it.
//   4. Call controls name WHO is being called, not just "התקשר" ×8.
//   5. The all-clear state is never a dead end — it always offers an action.
//   6. The Leads handoff states what to do instead, with a real destination.
//   7. The view model maps BOTH Today pipelines to the same row shape, so a
//      v2-brief agency and a v1-worklist agency get the same mobile screen.
//
// Runs without a database: `npm run test:a11y` (VITEST_NO_DB=1).

import { describe, afterEach, test, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'

let pathname = '/dashboard'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, back: () => {} }),
  usePathname: () => pathname,
}))

import MobileWorkspaceShell from '@/components/mobile/MobileWorkspaceShell'
import MobileToday from '@/modules/today/mobile/MobileToday'
import MobileSectionHandoff from '@/components/mobile/MobileSectionHandoff'
import { modelFromBrief, modelFromSnapshot, type MobileTodayModel } from '@/modules/today/mobile/viewModel'

afterEach(() => {
  cleanup()
  pathname = '/dashboard'
})

const row = (i: number, over: Partial<MobileTodayModel['rest'][number]> = {}) => ({
  id: i,
  name: `דני לוי ${i}`,
  phone: '0540000000',
  reason: 'מעקב באיחור',
  href: `/clients/${i}/summary`,
  ...over,
})

const model = (over: Partial<MobileTodayModel> = {}): MobileTodayModel => ({
  hero: row(1),
  nextUp: [row(2)],
  rest: [row(3), row(4)],
  remaining: 4,
  restTotal: 2,
  doneToday: 3,
  meetings: 1,
  newLeadsCount: 2,
  source: 'worklist_v1',
  ...over,
})

describe('mobile workspace shell', () => {
  test('1. exposes exactly one main and one nav landmark', () => {
    render(
      <MobileWorkspaceShell>
        <p>תוכן</p>
      </MobileWorkspaceShell>,
    )
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getAllByRole('navigation')).toHaveLength(1)
    expect(screen.getByRole('navigation', { name: 'ניווט ראשי' })).toBeTruthy()
  })

  test('1b. does NOT mount the desktop sidebar alongside the tab bar', () => {
    const { container } = render(
      <MobileWorkspaceShell>
        <p>תוכן</p>
      </MobileWorkspaceShell>,
    )
    // The desktop Nav renders a `popover` drawer; its absence proves the two
    // shells are mutually exclusive rather than CSS-hidden duplicates.
    expect(container.querySelector('#navPop')).toBeNull()
    expect(screen.getAllByRole('navigation')).toHaveLength(1)
  })

  test('2. a tab screen renders no back control', () => {
    pathname = '/dashboard'
    render(
      <MobileWorkspaceShell>
        <p>תוכן</p>
      </MobileWorkspaceShell>,
    )
    expect(screen.queryByRole('button', { name: 'חזרה' })).toBeNull()
  })

  test('2b. a non-tab screen (lead detail) renders a back control', () => {
    pathname = '/clients/1/summary'
    render(
      <MobileWorkspaceShell>
        <p>תוכן</p>
      </MobileWorkspaceShell>,
    )
    expect(screen.getByRole('button', { name: 'חזרה' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'ליד' })).toBeTruthy()
  })

  test('the shell carries the full-bleed scoping hook', () => {
    const { container } = render(
      <MobileWorkspaceShell>
        <p>תוכן</p>
      </MobileWorkspaceShell>,
    )
    // Removing this attribute silently re-breaks the lead-detail chrome, which
    // measured 32px past both viewport edges without it.
    expect(container.querySelector('[data-mobile-workspace]')).not.toBeNull()
  })
})

describe('mobile Today', () => {
  test('3. renders the hero and its section headings', () => {
    render(<MobileToday model={model()} />)
    expect(screen.getByText('התחל כאן')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'אחר כך' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /ממתינים/ })).toBeTruthy()
  })

  test('4. each call control names WHO is being called', () => {
    render(<MobileToday model={model()} />)
    expect(screen.getByRole('link', { name: 'התקשר לדני לוי 1' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'התקשר לדני לוי 2' })).toBeTruthy()
  })

  test('4b. a lead with no phone still offers a way in (never a dead row)', () => {
    render(<MobileToday model={model({ hero: row(1, { phone: null }), nextUp: [], rest: [] })} />)
    expect(screen.getByRole('link', { name: 'פתח ליד' })).toBeTruthy()
  })

  test('5. the all-clear state offers an action rather than a blank screen', () => {
    render(<MobileToday model={model({ hero: null, nextUp: [], rest: [], remaining: 0, restTotal: 0 })} />)
    expect(screen.getByRole('heading', { name: 'אין עכשיו מה לעשות' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '2 לידים חדשים' })).toBeTruthy()
  })

  test('5b. all-clear with nothing new still links somewhere real', () => {
    render(
      <MobileToday
        model={model({ hero: null, nextUp: [], rest: [], remaining: 0, restTotal: 0, newLeadsCount: 0 })}
      />,
    )
    expect(screen.getByRole('link', { name: 'כל הלידים' })).toBeTruthy()
  })

  test('discloses the cap instead of silently truncating', () => {
    render(<MobileToday model={model({ rest: [row(3)], restTotal: 24 })} />)
    expect(screen.getByText(/מוצגים 1 מתוך 24/)).toBeTruthy()
  })
})

describe('section handoff', () => {
  test('6. states the situation and offers a real destination', () => {
    render(
      <MobileSectionHandoff
        icon='image-polaroid-user'
        title='רשימת הלידים מגיעה בקרוב לנייד'
        body='בינתיים אפשר לעבוד מהמסך "היום".'
        action={{ href: '/dashboard' as never, label: 'מה צריך לעשות היום' }}
      />,
    )
    expect(screen.getByRole('heading', { name: 'רשימת הלידים מגיעה בקרוב לנייד' })).toBeTruthy()
    const cta = screen.getByRole('link', { name: 'מה צריך לעשות היום' })
    expect(cta.getAttribute('href')).toBe('/dashboard')
  })
})

describe('view model — both Today pipelines produce the same shape', () => {
  test('7. v1 worklist maps recommended + due into hero / nextUp / rest', () => {
    const m = modelFromSnapshot(
      {
        due: [],
        dueCount: 5,
        newLeadsCount: 1,
        upcomingCount: 0,
        doneToday: 2,
        meetings: [],
        recommended: [
          { lead: { id: 1, name: 'א', phone: '050', status: null, nextFollowUpAt: null }, reason: 'מעקב באיחור' },
          { lead: { id: 2, name: 'ב', phone: null, status: null, nextFollowUpAt: null }, reason: 'ליד חדש' },
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tableRows: [{ id: 3, name: 'ג', phone: '052', status: 'new', nextFollowUpAt: null } as any],
        tableTotal: 3,
        progressPct: 40,
      },
      Date.parse('2026-08-12T09:00:00Z'),
    )
    expect(m.source).toBe('worklist_v1')
    expect(m.hero?.id).toBe(1)
    expect(m.nextUp.map((r) => r.id)).toEqual([2])
    expect(m.rest.map((r) => r.id)).toEqual([3])
    expect(m.rest[0].reason.length).toBeGreaterThan(0)
    expect(m.hero?.href).toBe('/clients/1/summary')
  })

  test('7b. v2 brief maps items into the identical row shape', () => {
    const m = modelFromBrief({
      greeting: 'בוקר טוב',
      firstName: 'אלמוג',
      items: [
        { id: 10, name: 'א', phone: '050', state: 'FOLLOWUP_OVERDUE', reason: 'מעקב באיחור', targetSurface: 'lead' },
        { id: 11, name: 'ב', phone: null, state: 'WAITING_REPLY', reason: 'ממתין לתשובה שלך', targetSurface: 'inbox' },
      ],
      total: 2,
      remaining: 2,
      handledToday: 1,
      done: false,
      volumeState: 'normal',
      statusVerdict: 'active',
      permissionVerdict: 'scoped_all_clear',
      meetings: [],
    })
    expect(m.source).toBe('brief_v2')
    expect(m.hero?.id).toBe(10)
    // Same shape as v1 — the presentation cannot tell which pipeline fed it.
    expect(Object.keys(m.hero!).sort()).toEqual(['href', 'id', 'name', 'phone', 'reason'])
    // An inbox-targeted item still routes somewhere real on mobile.
    expect(m.nextUp[0].href).toBe('/clients/11/summary')
  })
})
