// @vitest-environment jsdom
//
// Mobile lead card: navigation targets and event isolation.
//
// THE DEFECT THIS LOCKS DOWN. Tapping a lead's name or card opened WhatsApp
// instead of the lead. The cause was NOT event propagation and NOT nested
// interactive elements — the card's own `href` was the inbox thread whenever the
// lead had a conversation (viewModel: `item.conversationId ? '/inbox?...' : leadHref`).
// So the card was doing exactly what it was told; it was told the wrong thing.
//
// These tests pin both halves: where each control navigates, and that the three
// controls never trigger each other.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const push = vi.fn()
const resolveConversation = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: () => {}, refresh: () => {} }),
  usePathname: () => '/today',
}))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({
  recordLeadActionEvent: vi.fn(async () => {}),
}))
vi.mock('@/modules/inbox/actions', () => ({
  resolveLeadWhatsappConversation: (...a: unknown[]) => resolveConversation(...a),
}))

import MobileTodayHero from '@/modules/today/mobile/MobileTodayHero'
import MobileTodayRow from '@/modules/today/mobile/MobileTodayRow'

const SUMMARY = '/clients/7/summary'

const row = (over: Record<string, unknown> = {}) =>
  ({ id: 7, name: 'דני לוי', phone: '0541234567', reason: 'ממתין 6 ימים', href: SUMMARY, ...over }) as never

beforeEach(() => {
  push.mockClear()
  resolveConversation.mockReset()
  resolveConversation.mockResolvedValue({ conversationId: 99 })
})
afterEach(() => cleanup())

describe('navigation targets', () => {
  it('NAV-1: the card / name area links to the lead summary', () => {
    render(<MobileTodayHero row={row()} />)
    const nameLink = screen.getAllByRole('link').find((a) => a.textContent?.includes('דני לוי'))
    expect(nameLink?.getAttribute('href')).toBe(SUMMARY)
  })

  it('NAV-2: "פתח" links to the lead summary', () => {
    render(<MobileTodayHero row={row()} />)
    const open = screen.getByRole('link', { name: 'פתח את דני לוי' })
    expect(open.getAttribute('href')).toBe(SUMMARY)
  })

  it('NAV-3: a lead WITH a conversation still routes the card to the lead, never the inbox', () => {
    render(<MobileTodayHero row={row({ cta: 'open_conversation' })} />)
    for (const a of screen.getAllByRole('link')) {
      expect(a.getAttribute('href')).not.toContain('/inbox')
    }
  })

  it('NAV-4: the list row links to the lead summary too', () => {
    render(<MobileTodayRow row={row()} />)
    const link = screen.getAllByRole('link').find((a) => a.textContent?.includes('דני לוי'))
    expect(link?.getAttribute('href')).toBe(SUMMARY)
  })
})

describe('event isolation between card, WhatsApp and Call', () => {
  it('ISO-1: tapping WhatsApp runs ONLY the WhatsApp action — no card navigation', async () => {
    render(<MobileTodayRow row={row()} />)

    fireEvent.click(screen.getByRole('button', { name: 'וואטסאפ לדני לוי' }))

    await waitFor(() => expect(resolveConversation).toHaveBeenCalledWith(7))
    // It navigates to the CONVERSATION (its own job) and never to the lead card's target.
    await waitFor(() => expect(push).toHaveBeenCalledWith('/inbox?conversation=99'))
    expect(push).not.toHaveBeenCalledWith(SUMMARY)
  })

  it('ISO-2: the WhatsApp button stops propagation so an ancestor row handler cannot fire', () => {
    const ancestor = vi.fn()
    render(
      <div onClick={ancestor}>
        <MobileTodayRow row={row()} />
      </div>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'וואטסאפ לדני לוי' }))

    expect(ancestor).not.toHaveBeenCalled()
  })

  it('ISO-3: Call is a real tel: anchor and stops propagation — no card navigation', () => {
    const ancestor = vi.fn()
    render(
      <div onClick={ancestor}>
        <MobileTodayRow row={row()} />
      </div>,
    )

    const call = screen.getByRole('link', { name: 'התקשר לדני לוי' })
    expect(call.getAttribute('href')).toBe('tel:0541234567')

    fireEvent.click(call)

    expect(ancestor).not.toHaveBeenCalled()
    expect(resolveConversation).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('ISO-4: navigating the card does NOT trigger the WhatsApp action', () => {
    render(<MobileTodayRow row={row()} />)
    const link = screen.getAllByRole('link').find((a) => a.textContent?.includes('דני לוי'))!

    fireEvent.click(link)

    expect(resolveConversation).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('ISO-5: no interactive element is nested inside an anchor (valid tap targets)', () => {
    const { container } = render(<MobileTodayRow row={row()} />)
    expect(container.querySelectorAll('a a').length).toBe(0)
    expect(container.querySelectorAll('a button').length).toBe(0)
    expect(container.querySelectorAll('button a').length).toBe(0)
  })

  it('ISO-6: the hero has no nested interactive elements either', () => {
    const { container } = render(<MobileTodayHero row={row()} />)
    expect(container.querySelectorAll('a a').length).toBe(0)
    expect(container.querySelectorAll('a button').length).toBe(0)
  })
})
