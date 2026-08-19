// @vitest-environment jsdom
//
// Mobile Today — the rendered contract (P0-1).
//
// Guarantees locked in (do not weaken):
//   1. NO NESTED INTERACTIVE ELEMENTS. The pre-P0-1 row put a `tel:` anchor in
//      `MobileListRow`'s `trailing` slot, which renders INSIDE the row's own
//      `<Link>` — an `<a>` inside an `<a>`. Measured on the real screen at 360,
//      375, 390 and 430px, every populated Today list reported nested pairs.
//   2. Every row offers BOTH WhatsApp and Call, each with an accessible name.
//   3. WhatsApp is a BUTTON, not a `wa.me` anchor — it routes through the in-app
//      conversation (`openLeadWhatsappInInbox`). `wa.me` survives only as the
//      runtime fallback inside that component, never as the rendered primary.
//   4. The hero offers both actions too — it used to offer exactly one.
//   5. The clear state stays a result, not an error, and keeps one action.
//
// Renders without a database: `npm run test:a11y` (VITEST_NO_DB=1).

import { describe, afterEach, test, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => '/dashboard',
}))

import MobileToday from '@/modules/today/mobile/MobileToday'
import MobileTodayHero from '@/modules/today/mobile/MobileTodayHero'
import type { MobileTodayModel, MobileTodayRow } from '@/modules/today/mobile/viewModel'

afterEach(cleanup)

const row = (id: number, over: Partial<MobileTodayRow> = {}): MobileTodayRow => ({
  id,
  name: `ליד ${id}`,
  phone: `050000000${id}`,
  reason: `סיבה ${id}`,
  href: `/clients/${id}/summary`,
  ...over,
})

const model = (over: Partial<MobileTodayModel> = {}): MobileTodayModel => ({
  hero: row(1),
  nextUp: [row(2), row(3)],
  rest: [row(4), row(5)],
  remaining: 5,
  restTotal: 2,
  doneToday: 3,
  meetings: 1,
  newLeadsCount: 0,
  source: 'brief_v2',
  ...over,
})

/** Every `<a>`/`<button>` whose nearest interactive ancestor is another one. */
function nestedInteractive(container: HTMLElement) {
  return Array.from(container.querySelectorAll('a, button')).filter((el) => {
    const outer = el.parentElement?.closest('a, button')
    return outer != null && outer !== el
  })
}

describe('1. no nested interactive elements (the P0-1 defect)', () => {
  test('a populated Today renders zero nested tap targets', () => {
    const { container } = render(<MobileToday model={model()} />)
    const nested = nestedInteractive(container)
    expect(
      nested.map((e) => `${e.tagName}:${e.getAttribute('aria-label') || e.textContent?.slice(0, 20)}`),
    ).toEqual([])
  })

  test('the row link and the contact actions are SIBLINGS, not parent and child', () => {
    const { container } = render(<MobileToday model={model({ hero: null, nextUp: [], rest: [row(9)] })} />)
    const link = container.querySelector('a[href="/clients/9/summary"]')!
    const wa = screen.getByRole('button', { name: 'וואטסאפ לליד 9' })
    expect(link.contains(wa)).toBe(false)
    expect(wa.closest('a')).toBeNull()
  })
})

describe('2 & 3. every row offers WhatsApp and Call', () => {
  test('each list row exposes both actions with accessible names', () => {
    render(<MobileToday model={model()} />)
    for (const id of [2, 3, 4, 5]) {
      expect(screen.getByRole('button', { name: `וואטסאפ לליד ${id}` })).toBeTruthy()
      expect(screen.getByRole('link', { name: `התקשר לליד ${id}` })).toBeTruthy()
    }
  })

  test('WhatsApp is a button (in-app routing), never a wa.me anchor', () => {
    const { container } = render(<MobileToday model={model()} />)
    const wa = screen.getAllByRole('button', { name: /וואטסאפ/ })
    expect(wa.length).toBeGreaterThan(0)
    for (const b of wa) expect(b.tagName).toBe('BUTTON')
    // Nothing on the screen links straight out to WhatsApp.
    expect(container.querySelector('a[href*="wa.me"]')).toBeNull()
  })

  test('Call stays a real tel: anchor — dialling is an OS navigation', () => {
    render(<MobileToday model={model()} />)
    const call = screen.getByRole('link', { name: 'התקשר לליד 4' })
    expect(call.getAttribute('href')).toBe('tel:0500000004')
  })

  /**
   * A lead with no number gets NO contact cluster at all — `LeadContactActions`
   * returns null when there is neither a phone nor a usable `wa.me` target.
   * That is correct rather than a gap: WhatsApp is addressed by phone number
   * too, so a "send WhatsApp" button here could only fail. The row still links
   * to the record, so the rep is never dead-ended — they land where the email,
   * the history and the composer are.
   */
  test('a row without a phone renders no contact controls, but still opens the lead', () => {
    const { container } = render(<MobileToday model={model({ hero: null, nextUp: [], rest: [row(8, { phone: null })] })} />)
    expect(screen.queryByRole('button', { name: /וואטסאפ/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /התקשר/ })).toBeNull()
    expect(container.querySelector('a[href="/clients/8/summary"]')).toBeTruthy()
  })

  test('the contact controls carry the pressed-state class', () => {
    render(<MobileToday model={model({ hero: null, nextUp: [], rest: [row(6)] })} />)
    expect(screen.getByRole('button', { name: 'וואטסאפ לליד 6' }).className).toContain('press')
    expect(screen.getByRole('link', { name: 'התקשר לליד 6' }).className).toContain('press')
  })
})

describe('4. the hero offers both actions', () => {
  test('a hero with a phone exposes WhatsApp and Call, plus a way into the record', () => {
    render(<MobileTodayHero row={row(1)} />)
    expect(screen.getByRole('button', { name: 'וואטסאפ לליד 1' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'התקשר לליד 1' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'פתח את ליד 1' })).toBeTruthy()
  })

  test('a waiting-conversation hero keeps its conversation entry point', () => {
    render(
      <MobileTodayHero
        row={row(1, { href: '/inbox?conversation=42', cta: 'open_conversation', eyebrow: 'צריך לטפל עכשיו' })}
      />,
    )
    const open = screen.getByRole('link', { name: 'פתח שיחה עם ליד 1' })
    expect(open.getAttribute('href')).toBe('/inbox?conversation=42')
    // …and can now also be called, which the single-action hero could not do.
    expect(screen.getByRole('link', { name: 'התקשר לליד 1' })).toBeTruthy()
  })

  test('a hero with no phone falls back to one clear link, not a dead button', () => {
    render(<MobileTodayHero row={row(1, { phone: null })} />)
    expect(screen.queryByRole('link', { name: /התקשר/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'פתח ליד' })).toBeTruthy()
  })

  test('the hero is a labelled region with exactly one eyebrow', () => {
    const { container } = render(<MobileTodayHero row={row(1)} />)
    expect(container.querySelector('section')?.getAttribute('aria-labelledby')).toBe('mobile-today-hero')
    expect(nestedInteractive(container)).toEqual([])
  })

  test('the hero is a white card, not a tinted wash', () => {
    const { container } = render(<MobileTodayHero row={row(1)} />)
    const section = container.querySelector('section')!
    expect(section.className).toContain('bg-white')
    expect(section.className).toContain('border-gray-200')
    expect(section.className).not.toContain('bg-primary-tint')
    expect(section.className).not.toContain('uppercase')
  })

  test('open is a labelled control, not an icon-only chevron', () => {
    render(<MobileTodayHero row={row(1)} />)
    const open = screen.getByRole('link', { name: 'פתח את ליד 1' })
    expect(open.textContent).toContain('פתח')
  })
})

describe('5. structure and empty states', () => {
  test('sections are labelled headings, and remaining lives on the hero', () => {
    render(<MobileToday model={model()} />)
    const later = screen.getByRole('heading', { name: 'אחר כך' })
    expect(later).toBeTruthy()
    expect(later.className).not.toContain('uppercase')
    expect(screen.getByRole('heading', { name: /ממתינים/ })).toBeTruthy()
    expect(screen.getByText(/5 ממתינים/)).toBeTruthy()
  })

  test('the truncation notice appears only when rows are actually hidden', () => {
    const { rerender } = render(<MobileToday model={model({ restTotal: 2 })} />)
    expect(screen.queryByText(/מוצגים/)).toBeNull()

    rerender(<MobileToday model={model({ restTotal: 87 })} />)
    expect(screen.getByText(/מוצגים 2 מתוך 87/)).toBeTruthy()
  })

  test('nothing due renders the clear state with one real action', () => {
    render(<MobileToday model={model({ hero: null, nextUp: [], rest: [], remaining: 0, restTotal: 0 })} />)
    expect(screen.getByRole('heading', { name: 'אין עכשיו מה לעשות' })).toBeTruthy()
    const cta = screen.getByRole('link', { name: 'כל הלידים' })
    expect(cta.getAttribute('href')).toBe('/leads')
  })

  test('a hero-less screen with rows is NOT the clear state', () => {
    const { container } = render(<MobileToday model={model({ hero: null, nextUp: [], rest: [row(4)] })} />)
    expect(screen.queryByRole('heading', { name: 'אין עכשיו מה לעשות' })).toBeNull()
    // Queried by href: the row link and its Call sibling both carry the lead's
    // name, so a name matcher is ambiguous by design here.
    expect(container.querySelector('a[href="/clients/4/summary"]')).toBeTruthy()
  })

  test('no table is ever rendered inside the phone entity', () => {
    const { container } = render(<MobileToday model={model()} />)
    expect(container.querySelector('table')).toBeNull()
  })

  test('each row links to its own destination', () => {
    const { container } = render(
      <MobileToday
        model={model({ hero: null, nextUp: [], rest: [row(4), row(5, { href: '/inbox?conversation=7' })] })}
      />,
    )
    expect(container.querySelector('a[href="/clients/4/summary"]')).toBeTruthy()
    expect(container.querySelector('a[href="/inbox?conversation=7"]')).toBeTruthy()
  })

  test('overdue reasons use semantic colour, not gray body text', () => {
    render(
      <MobileToday
        model={model({ hero: null, nextUp: [], rest: [row(4, { reason: 'מעקב באיחור' })] })}
      />,
    )
    const reason = screen.getByText('מעקב באיחור')
    expect(reason.parentElement?.className).toContain('text-error-text')
  })
})

describe('6. reason tone is derived from existing labels', () => {
  test('overdue and waiting map to semantic tones', async () => {
    const { todayReasonTone, todayWindowHintTone } = await import('@/modules/today/mobile/reasonTone')
    expect(todayReasonTone('מעקב באיחור')).toBe('error')
    expect(todayReasonTone('משימה באיחור')).toBe('error')
    expect(todayReasonTone('מעקב להיום')).toBe('warning')
    expect(todayReasonTone('ממתין 6 ימים')).toBe('warning')
    expect(todayReasonTone('ליד חדש')).toBeNull()
    expect(todayWindowHintTone('חלון WhatsApp נסגר')).toBe('warning')
    expect(todayWindowHintTone('נותרו 17 שעות בחלון WhatsApp')).toBeNull()
  })
})
