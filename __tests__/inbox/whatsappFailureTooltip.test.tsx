// @vitest-environment jsdom
//
// Failed-WhatsApp-message tooltip (Option B): the existing red status icon gets a
// self-contained native `title` composed from the ALREADY-mapped failureText, plus
// a WhatsApp attribution line. Reuses lib/inbox/whatsappErrorCopy — no new mapper,
// no code/wamid/payload ever in the tooltip path. Pure client, no DB: VITEST_NO_DB=1.

import { afterEach, describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'

import { failureTooltipText, mapWhatsappError } from '@/lib/inbox/whatsappErrorCopy'
import WhatsappMessageStatus from '@/components/summary/WhatsappMessageStatus'

const ATTRIBUTION = 'הסטטוס התקבל מ־WhatsApp.'
const TITLE = 'ההודעה לא נשלחה'

afterEach(cleanup)

describe('failureTooltipText — composition from mapped failureText', () => {
  const known = {
    window: mapWhatsappError(131047).text, // window_expired
    recipient: mapWhatsappError(131026).text,
    account: mapWhatsappError(131031).text,
    generic: mapWhatsappError(999999).text, // unknown → generic
  }

  it('known reason → title, the human reason, attribution — title NOT duplicated', () => {
    const tip = failureTooltipText(known.window)
    const lines = tip.split('\n')
    expect(lines[0]).toBe(TITLE)
    expect(lines[1]).toBe('עברו יותר מ־24 שעות מאז שהליד כתב. אפשר להתקשר אליו.')
    expect(lines[2]).toBe(ATTRIBUTION)
    // the opener appears exactly once (no "ההודעה לא נשלחה — ..." duplication)
    expect(tip.match(/ההודעה לא נשלחה/g)!.length).toBe(1)
    // the reason line does not carry the em-dash prefix
    expect(lines[1].startsWith('ההודעה לא נשלחה')).toBe(false)
  })

  it('recipient reason → clean 3-line tooltip', () => {
    expect(failureTooltipText(known.recipient)).toBe(`${TITLE}\nהמספר אינו פעיל ב־WhatsApp.\n${ATTRIBUTION}`)
  })

  it('account reason → clean 3-line tooltip', () => {
    expect(failureTooltipText(known.account)).toBe(
      `${TITLE}\nשליחת הודעות מושבתת כרגע. נדרשת בדיקה בהגדרות החשבון.\n${ATTRIBUTION}`,
    )
  })

  it('generic failureText → title + attribution only (drops "נסה שוב" filler, no reason line)', () => {
    const tip = failureTooltipText(known.generic)
    expect(tip).toBe(`${TITLE}\n${ATTRIBUTION}`)
    expect(tip).not.toContain('נסה שוב')
  })

  it('null failureText → generic title + attribution', () => {
    expect(failureTooltipText(null)).toBe(`${TITLE}\n${ATTRIBUTION}`)
    expect(failureTooltipText(undefined)).toBe(`${TITLE}\n${ATTRIBUTION}`)
  })

  it('never leaks a Meta error code / wamid / raw payload token', () => {
    // Every numeric Meta code the mapper knows about must never surface as text.
    const META_CODES = ['470', '131047', '131051', '131026', '131052', '131031', '131042', '131049', '141006']
    for (const ft of [known.window, known.recipient, known.account, known.generic, null]) {
      const tip = failureTooltipText(ft)
      for (const code of META_CODES) expect(tip).not.toContain(code)
      expect(tip.toLowerCase()).not.toContain('wamid')
      expect(tip).not.toContain('metadata')
      expect(tip).not.toContain('fbtrace')
    }
  })
})

describe('WhatsappMessageStatus — failed indicator gets the native title + sr-only', () => {
  it('failed + known reason → title has reason AND attribution; sr-only communicates the same', () => {
    const { container } = render(<WhatsappMessageStatus status='failed' failureText={mapWhatsappError(131026).text} />)
    const span = container.querySelector('span[title]') as HTMLElement
    expect(span).toBeTruthy()
    const title = span.getAttribute('title')!
    expect(title).toContain('המספר אינו פעיל ב־WhatsApp.')
    expect(title).toContain(ATTRIBUTION)
    expect(title.match(/ההודעה לא נשלחה/g)!.length).toBe(1)
    // sr-only mirrors the tooltip meaning (not the terse old label alone)
    const sr = container.querySelector('.sr-only') as HTMLElement
    expect(sr.textContent).toContain('המספר אינו פעיל ב־WhatsApp.')
    expect(sr.textContent).toContain(ATTRIBUTION)
  })

  it('failed + null failureText → generic title + attribution', () => {
    const { container } = render(<WhatsappMessageStatus status='failed' failureText={null} />)
    const title = (container.querySelector('span[title]') as HTMLElement).getAttribute('title')
    expect(title).toBe(`${TITLE}\n${ATTRIBUTION}`)
  })

  it('sent / delivered / read → NO failure title (unchanged behavior)', () => {
    for (const status of ['sent', 'delivered', 'read'] as const) {
      const { container } = render(<WhatsappMessageStatus status={status} />)
      expect(container.querySelector('span[title]')).toBeNull()
      // sr-only keeps the terse state label
      expect(container.querySelector('.sr-only')!.textContent).not.toContain(ATTRIBUTION)
      cleanup()
    }
  })
})

// The inline failure reason under the bubble must stay present and unchanged.
// Mock the heavy conversation children so we render only the message list.
vi.mock('@/components/summary/WhatsappReplyDraft', () => ({ default: () => <div data-mock='reply' /> }))
vi.mock('@/components/summary/WhatsappNewMessageNotifier', () => ({ default: () => null }))
vi.mock('@/components/summary/WhatsappConversationHeader', () => ({ default: () => <div data-mock='header' /> }))
vi.mock('@/modules/inbox/components/ChannelIcon', () => ({ default: () => <span data-mock='chan' /> }))

import WhatsappConversation from '@/components/summary/WhatsappConversation'

describe('WhatsappConversation — inline failure text preserved alongside the new tooltip', () => {
  const failedMsg: any = {
    id: 1,
    direction: 'outbound',
    status: 'failed',
    text: 'שלום',
    timestamp: '2026-07-27T10:00:00.000Z',
    failureText: mapWhatsappError(131026).text, // 'ההודעה לא נשלחה — המספר אינו פעיל ב־WhatsApp.'
  }

  it('still renders the inline mapped reason AND now also exposes the status tooltip', () => {
    const { container } = render(<WhatsappConversation messages={[failedMsg]} leadId={1} />)
    // inline <p> (unchanged): full mapped failureText visible without hover
    expect(screen.getByText(failedMsg.failureText)).toBeTruthy()
    // new: the status icon carries the composed tooltip
    const tipSpan = container.querySelector('span[title]') as HTMLElement
    expect(tipSpan).toBeTruthy()
    expect(tipSpan.getAttribute('title')).toContain(ATTRIBUTION)
  })
})
