// @vitest-environment jsdom
//
// Today (desktop) brief — presentational components after the v2 visual refresh.
//
// These are pure functions of the TodayBrief DTO. The tests pin what the refresh
// must NOT change (every displayed value maps to an existing DTO field, both
// mission modes survive, the list is never capped) and the empty states that
// hide whole blocks instead of rendering zeros.

import { describe, it, expect, afterEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react'
import TodayBriefView from '@/components/home/today/TodayBriefView'
import BriefHero from '@/components/home/today/BriefHero'
import BriefMission from '@/components/home/today/BriefMission'
import BriefList from '@/components/home/today/BriefList'
import BriefMeetings from '@/components/home/today/BriefMeetings'
import type { BriefItem, TodayBrief } from '@/lib/today/types'

// The hero's progress ring is a Recharts chart; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

afterEach(() => cleanup())

const item = (over: Partial<BriefItem> = {}): BriefItem => ({
  id: 1,
  name: 'דני לוי',
  phone: '0541234567',
  state: 'FOLLOWUP_OVERDUE',
  reason: 'מעקב באיחור',
  targetSurface: 'lead',
  href: null,
  conversationId: null,
  waitingFor: null,
  windowHint: null,
  ...over,
})

const brief = (over: Partial<TodayBrief> = {}): TodayBrief => ({
  greeting: 'ערב טוב',
  firstName: 'אלמיו',
  items: [],
  total: 0,
  remaining: 0,
  handledToday: 0,
  done: true,
  volumeState: 'clear',
  statusVerdict: 'covered',
  permissionVerdict: 'scoped_all_clear',
  meetings: [],
  ...over,
})

const inboxItem = (id: number) =>
  item({
    id,
    name: `ליד ${id}`,
    state: 'WAITING_REPLY',
    targetSurface: 'inbox',
    conversationId: 500 + id,
    href: `/inbox?conversation=${500 + id}`,
    waitingFor: 'ממתין 11 ימים',
    reason: 'ממתין לתשובה',
    windowHint: 'חלון WhatsApp נסגר',
  })

describe('BriefHero', () => {
  it('keeps the existing headline / subline copy and the greeting', () => {
    render(<BriefHero brief={brief({ done: false, remaining: 5, handledToday: 2, volumeState: 'busy', statusVerdict: 'active' })} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('ערב טוב, אלמיו')
    expect(screen.getByText('5 לידים דורשים אותך היום')).toBeTruthy()
    expect(screen.getByText('יום עמוס — התחל מהמשימה הראשונה')).toBeTruthy()
  })

  it('omits the comma when there is no first name', () => {
    render(<BriefHero brief={brief({ firstName: '' })} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('ערב טוב')
  })

  it('progress = handled / (handled + remaining), with meetings in the summary line', () => {
    render(
      <BriefHero
        brief={brief({ done: false, remaining: 3, handledToday: 1, meetings: [{ id: 1, title: null, at: 0 }, { id: 2, title: null, at: 0 }] })}
      />
    )
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('25')
    // The day's counts are stat badges beside the progress ring.
    expect(screen.getByText('1 טופלו היום')).toBeTruthy()
    expect(screen.getByText('3 נותרו')).toBeTruthy()
    expect(screen.getByText('2 פגישות')).toBeTruthy()
  })

  it('drops the meetings part when there are none', () => {
    render(<BriefHero brief={brief({ done: false, remaining: 3, handledToday: 1 })} />)
    expect(screen.queryByText(/פגישות/)).toBeNull()
  })

  it('hides the progress bar when handled and remaining are both zero', () => {
    render(<BriefHero brief={brief()} />)
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('shows 100% when the day is done with handled work', () => {
    render(<BriefHero brief={brief({ handledToday: 4 })} />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100')
  })

  it('links the add / import buttons to the leads dialogs', () => {
    render(<BriefHero brief={brief()} />)
    expect(screen.getByRole('link', { name: 'הוסף ליד' }).getAttribute('href')).toBe('/leads?add=1')
    expect(screen.getByRole('link', { name: 'ייבוא Excel' }).getAttribute('href')).toBe('/leads?import=1')
  })
})

describe('BriefMission', () => {
  it('conversation mode: opens the thread, with a labelled call button', () => {
    render(<BriefMission item={inboxItem(1)} />)
    expect(screen.getByText('המשימה הבאה')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'פתח שיחה' }).getAttribute('href')).toBe('/inbox?conversation=501')
    expect(screen.getByRole('link', { name: 'התקשר לליד 1' }).getAttribute('href')).toBe('tel:0541234567')
    expect(screen.getByText('ממתין 11 ימים').getAttribute('data-tone')).toBe('bad')
    expect(screen.getByText('ממתין לתשובה · חלון WhatsApp נסגר')).toBeTruthy()
  })

  it('lead mode: call + open lead, phone appended to the meta line', () => {
    render(<BriefMission item={item()} />)
    expect(screen.getByText('המשימה הבאה')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'התקשר' }).getAttribute('href')).toBe('tel:0541234567')
    expect(screen.getByRole('link', { name: 'פתח ליד' }).getAttribute('href')).toBe('/clients/1/summary')
    expect(screen.getByText('מעקב באיחור')).toBeTruthy()
    expect(screen.getByText('0541234567')).toBeTruthy()
  })

  it('renders no call button without a phone', () => {
    render(<BriefMission item={item({ phone: null })} />)
    expect(screen.queryByRole('link', { name: /התקשר/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'פתח ליד' })).toBeTruthy()
  })
})

describe('BriefList', () => {
  it('pages 10 rows at a time; every item stays reachable (nothing capped)', () => {
    const items = Array.from({ length: 25 }, (_, i) => item({ id: i + 1, name: `ליד ${i + 1}` }))
    render(<BriefList items={items} />)
    expect(screen.getByRole('columnheader', { name: 'ליד' })).toBeTruthy()
    expect(screen.getAllByRole('row')).toHaveLength(11) // header + 10
    expect(screen.getByText('עמוד 1 מתוך 3')).toBeTruthy()
    expect(screen.getByText('מציג 1–10 מתוך 25')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'לעמוד הקודם' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'לעמוד הבא' }))
    expect(screen.getByText('ליד 11')).toBeTruthy()
    expect(screen.queryByText('ליד 1')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'לעמוד האחרון' }))
    expect(screen.getByText('עמוד 3 מתוך 3')).toBeTruthy()
    expect(screen.getAllByRole('row')).toHaveLength(6) // header + 5
    expect((screen.getByRole('button', { name: 'לעמוד הבא' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByRole('combobox', { name: 'שורות בעמוד' }), { target: { value: '30' } })
    expect(screen.getAllByRole('row')).toHaveLength(26) // header + all 25
    expect(screen.getByText('עמוד 1 מתוך 1')).toBeTruthy()
  })

  it('wait chip shows waitingFor ?? reason, toned by state', () => {
    render(<BriefList items={[inboxItem(1), item({ id: 2, state: 'FOLLOWUP_DUE_TODAY', reason: 'מעקב היום' }), item({ id: 3, state: 'NEW_INBOUND', reason: 'ליד חדש' })]} />)
    expect(screen.getByText('ממתין 11 ימים').getAttribute('data-tone')).toBe('bad')
    expect(screen.getByText('מעקב היום').getAttribute('data-tone')).toBe('warn')
    expect(screen.getByText('ליד חדש').getAttribute('data-tone')).toBe('info')
  })

  it('WhatsApp action only for inbox items; call only with a phone', () => {
    render(<BriefList items={[inboxItem(1), item({ id: 2, name: 'בלי טלפון', phone: null })]} />)
    const [, first, second] = screen.getAllByRole('row')
    expect(within(first).getByRole('link', { name: 'פתח שיחת WhatsApp עם ליד 1' }).getAttribute('href')).toBe('/inbox?conversation=501')
    expect(within(first).getByRole('link', { name: 'התקשר לליד 1' })).toBeTruthy()
    expect(within(second).queryByRole('link', { name: /WhatsApp/ })).toBeNull()
    expect(within(second).queryByRole('link', { name: /התקשר/ })).toBeNull()
  })
})

describe('BriefMeetings', () => {
  it('renders the precomputed time label verbatim, with a title fallback', () => {
    render(
      <BriefMeetings
        meetings={[
          { id: 1, title: 'פגישת היכרות', at: 1, timeLabel: '10:30' },
          { id: 2, title: null, at: 2, timeLabel: '08:05' },
        ]}
      />
    )
    expect(screen.getByText('10:30')).toBeTruthy()
    expect(screen.getByText('08:05')).toBeTruthy()
    expect(screen.getByText('פגישה')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'ליומן' }).getAttribute('href')).toBe('/calendar')
  })

  it('a meeting without a label renders its title only (no empty chip)', () => {
    render(<BriefMeetings meetings={[{ id: 1, title: 'שיחת סגירה', at: 0 }, { id: 2, title: 'ללא שעה', at: 0, timeLabel: null }]} />)
    const rows = screen.getAllByRole('listitem')
    expect(rows[0].textContent).toBe('שיחת סגירה')
    expect(rows[1].textContent).toBe('ללא שעה')
  })
})

describe('TodayBriefView states', () => {
  it('done (0 items): hero only — no mission, no list', () => {
    render(<TodayBriefView brief={brief()} />)
    expect(screen.queryByText('המשימה הבאה')).toBeNull()
    expect(screen.queryByText('צריך לטפל עכשיו')).toBeNull()
    expect(screen.queryByText('פגישות היום')).toBeNull()
  })

  it('exactly one item: mission card only, list hidden', () => {
    render(<TodayBriefView brief={brief({ done: false, remaining: 1, items: [item()] })} />)
    expect(screen.getByText('המשימה הבאה')).toBeTruthy()
    expect(screen.queryByText('צריך לטפל עכשיו')).toBeNull()
  })

  it('items[0] is the mission, the rest go to the list', () => {
    render(<TodayBriefView brief={brief({ done: false, remaining: 3, items: [inboxItem(1), inboxItem(2), inboxItem(3)] })} />)
    expect(screen.getByRole('link', { name: 'פתח שיחה' }).getAttribute('href')).toBe('/inbox?conversation=501')
    expect(screen.getAllByRole('row')).toHaveLength(3) // header + 2
    expect(screen.getByRole('tab', { name: /צריך לטפל עכשיו/ }).textContent).toContain('2')
    expect(screen.getByRole('link', { name: 'לכל הלידים ←' }).getAttribute('href')).toBe('/leads')
  })

  it('meetings render even when the brief is done', () => {
    render(<TodayBriefView brief={brief({ meetings: [{ id: 1, title: 'שיחת סגירה', at: Date.UTC(2026, 9, 22, 13, 15) }] })} />)
    expect(screen.getByText('פגישות היום')).toBeTruthy()
    expect(screen.queryByText('צריך לטפל עכשיו')).toBeNull()
  })
})

describe('dashboard additions (optional DTO fields + analytics slots)', () => {
  it('hero shows the server date label when present', () => {
    render(<BriefHero brief={brief({ dateLabel: 'יום חמישי, 22 באוקטובר' })} />)
    expect(screen.getByText('יום חמישי, 22 באוקטובר')).toBeTruthy()
  })

  it('list and mission show the lead-source label; no chip without one', () => {
    render(<BriefList items={[inboxItem(1), { ...inboxItem(2), source: 'WhatsApp' }]} />)
    const [, first, second] = screen.getAllByRole('row')
    expect(within(first).queryByText('WhatsApp')).toBeNull()
    expect(within(second).getByText('WhatsApp')).toBeTruthy()
    cleanup()
    render(<BriefMission item={item({ source: 'Facebook' })} />)
    expect(screen.getByText('Facebook')).toBeTruthy()
  })

  it('meetings show the subtitle under the title', () => {
    render(<BriefMeetings meetings={[{ id: 1, title: 'שיחת סגירה', at: 1, timeLabel: '16:15', subtitle: 'דני · פגישת וידאו' }]} />)
    expect(screen.getByText('דני · פגישת וידאו')).toBeTruthy()
  })

  it('renders the overview and funnel slots in place, without the brief depending on them', () => {
    render(
      <TodayBriefView
        brief={brief({ done: false, remaining: 2, items: [inboxItem(1), inboxItem(2)] })}
        overview={<div>OVERVIEW</div>}
        funnel={<div>FUNNEL</div>}
      />,
    )
    expect(screen.getByText('OVERVIEW')).toBeTruthy()
    expect(screen.getByText('FUNNEL')).toBeTruthy()
    expect(screen.getByText('צריך לטפל עכשיו')).toBeTruthy()
  })
})
