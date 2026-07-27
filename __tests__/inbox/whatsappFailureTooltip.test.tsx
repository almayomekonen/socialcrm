// @vitest-environment jsdom
//
// WhatsApp failed-message tooltip v2: a clip-safe portal hover/focus tooltip on the
// existing red status icon, with plain-language product guidance keyed on the
// already-persisted failure CATEGORY (never a raw Meta string/code). Pure client,
// no DB: VITEST_NO_DB=1.

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'

import { failureTooltip, normalizeFailureCategory } from '@/lib/inbox/whatsappErrorCopy'
import WhatsappMessageStatus from '@/components/summary/WhatsappMessageStatus'
import { HoverTooltip } from '@/components/ui/HoverTooltip'

afterEach(cleanup)

describe('failureTooltip — plain-language copy by allowlisted category', () => {
  it('window_expired → 24-hour explanation + CALL action (never promises templates)', () => {
    const t = failureTooltip('window_expired')
    expect(t.title).toBe('לא ניתן לשלוח את ההודעה')
    expect(t.explanation).toContain('24 שעות')
    expect(t.explanation).toContain('WhatsApp')
    expect(t.action).toContain('להתקשר')
    expect(t.action).not.toContain('תבנית') // no template promise
  })

  it('recipient → hedged number/WhatsApp explanation (not a certain claim)', () => {
    const t = failureTooltip('recipient')
    expect(t.explanation).toContain('נראה ש') // hedged, not "certainly has no WhatsApp"
    expect(t.action).toContain('בדוק שהמספר נכון')
  })

  it('account → account explanation, no billing/payment jargon', () => {
    const t = failureTooltip('account')
    expect(t.title).toBe('לא ניתן לשלוח הודעות כרגע')
    expect(t.explanation).toContain('החשבון המחובר')
    expect(t.action).toContain('חשבון WhatsApp')
    expect(`${t.title} ${t.explanation} ${t.action}`).not.toMatch(/תשלום|חיוב|אשראי/)
  })

  it('generic / unknown / null → no invented cause', () => {
    for (const c of ['generic', 'future_key', null, undefined]) {
      const t = failureTooltip(c as string | null | undefined)
      expect(t.title).toBe('ההודעה לא נשלחה')
      expect(t.explanation).toBe('WhatsApp לא הצליחה לשלוח את ההודעה.')
      expect(t.action).toContain('לנסות שוב')
    }
    expect(normalizeFailureCategory('future_key')).toBe('generic')
  })

  it('the removed "הסטטוס התקבל מ־WhatsApp." line is gone from every category', () => {
    for (const c of ['window_expired', 'recipient', 'account', 'generic'] as const) {
      const t = failureTooltip(c)
      expect(`${t.title} ${t.explanation} ${t.action}`).not.toContain('הסטטוס התקבל מ־WhatsApp')
    }
  })

  it('no duplicate "לא נשלחה" within a category', () => {
    for (const c of ['window_expired', 'recipient', 'account', 'generic'] as const) {
      const t = failureTooltip(c)
      const all = `${t.title} ${t.explanation} ${t.action}`
      expect((all.match(/לא נשלחה/g) || []).length).toBeLessThanOrEqual(1)
    }
  })

  it('never renders a raw Meta code / wamid / metadata / fbtrace', () => {
    const CODES = ['470', '131047', '131051', '131026', '131052', '131031', '131042', '131049', '141006']
    for (const c of ['window_expired', 'recipient', 'account', 'generic'] as const) {
      const t = failureTooltip(c)
      const all = `${t.title} ${t.explanation} ${t.action}`
      for (const code of CODES) expect(all).not.toContain(code)
      expect(all.toLowerCase()).not.toContain('wamid')
      expect(all).not.toContain('metadata')
      expect(all).not.toContain('fbtrace')
    }
  })
})

describe('WhatsappMessageStatus — failed becomes a tooltip trigger; others unchanged', () => {
  it('failed exposes the category guidance as an accessible name', () => {
    const { container } = render(<WhatsappMessageStatus status='failed' failureCategory='window_expired' />)
    const sr = container.querySelector('.sr-only')?.textContent ?? ''
    expect(sr).toContain('לא ניתן לשלוח את ההודעה')
    expect(sr).toContain('24 שעות')
    expect(sr).not.toContain('הסטטוס התקבל מ־WhatsApp')
  })

  it('non-failed status renders no focusable tooltip and keeps its terse label', () => {
    const { container } = render(<WhatsappMessageStatus status='delivered' />)
    expect(container.querySelector('[tabindex]')).toBeNull()
    expect(container.querySelector('.sr-only')?.textContent).toBe('נמסר')
  })
})

describe('HoverTooltip — clip-safe portal, quick open/close, keyboard', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const setup = () =>
    render(
      <HoverTooltip label='שם נגיש' content={<span>תוכן טולטיפ</span>}>
        <b data-testid='trigger-child'>i</b>
      </HoverTooltip>,
    )
  const trigger = () => document.querySelector('span[tabindex="0"]') as HTMLElement
  const tip = () => document.querySelector('[role="tooltip"]')

  it('hover opens after the ~120ms delay, rendered through a document.body portal', () => {
    setup()
    fireEvent.mouseEnter(trigger())
    expect(tip()).toBeNull() // delayed, not immediate
    act(() => vi.advanceTimersByTime(150))
    const el = tip() as HTMLElement | null
    expect(el).toBeTruthy()
    expect(el?.parentElement).toBe(document.body) // clip-safe portal
    expect(el?.getAttribute('role')).toBe('tooltip')
    expect(el?.style.position).toBe('fixed')
    expect(el?.textContent).toContain('תוכן טולטיפ')
  })

  it('keyboard focus opens immediately (no delay)', () => {
    setup()
    fireEvent.focus(trigger())
    expect(tip()).toBeTruthy()
  })

  it('mouse leave closes', () => {
    setup()
    fireEvent.focus(trigger())
    expect(tip()).toBeTruthy()
    fireEvent.mouseLeave(trigger())
    expect(tip()).toBeNull()
  })

  it('blur closes', () => {
    setup()
    fireEvent.focus(trigger())
    expect(tip()).toBeTruthy()
    fireEvent.blur(trigger())
    expect(tip()).toBeNull()
  })

  it('Escape closes without trapping focus', () => {
    setup()
    fireEvent.focus(trigger())
    expect(tip()).toBeTruthy()
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(tip()).toBeNull()
  })

  it('trigger is keyboard reachable and carries an accessible name', () => {
    setup()
    expect(trigger().getAttribute('tabindex')).toBe('0')
    expect(trigger().textContent).toContain('שם נגיש')
  })
})

// The inline failure reason under the bubble must remain (mobile/touch has no hover).
vi.mock('@/components/summary/WhatsappReplyDraft', () => ({ default: () => <div data-mock='reply' /> }))
vi.mock('@/components/summary/WhatsappNewMessageNotifier', () => ({ default: () => null }))
vi.mock('@/components/summary/WhatsappConversationHeader', () => ({ default: () => <div data-mock='header' /> }))
vi.mock('@/modules/inbox/components/ChannelIcon', () => ({ default: () => <span data-mock='chan' /> }))

import WhatsappConversation from '@/components/summary/WhatsappConversation'

describe('WhatsappConversation — inline failure reason preserved (mobile-safe)', () => {
  const failed: any = {
    id: 1,
    direction: 'outbound',
    type: 'text',
    status: 'failed',
    text: 'שלום',
    timestamp: '2026-07-27T10:00:00.000Z',
    failureText: 'ההודעה לא נשלחה — המספר אינו פעיל ב־WhatsApp.',
    failureCategory: 'recipient',
  }

  it('still renders the inline mapped reason without hover', () => {
    render(<WhatsappConversation messages={[failed]} leadId={1} />)
    expect(screen.getByText(failed.failureText)).toBeTruthy()
  })
})
