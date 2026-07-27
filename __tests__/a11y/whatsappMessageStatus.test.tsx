// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import WhatsappMessageStatus from '@/components/summary/WhatsappMessageStatus'

afterEach(cleanup)

describe('WhatsappMessageStatus — accessible names', () => {
  it('sent does NOT claim delivery', () => {
    render(<WhatsappMessageStatus status='sent' />)
    expect(screen.getByText('נשלח — ממתין לאישור מסירה')).toBeInTheDocument()
    expect(screen.queryByText('נמסר')).toBeNull()
  })

  it('delivered says נמסר', () => {
    render(<WhatsappMessageStatus status='delivered' />)
    expect(screen.getByText('נמסר')).toBeInTheDocument()
  })

  it('read says נקרא', () => {
    render(<WhatsappMessageStatus status='read' />)
    expect(screen.getByText('נקרא')).toBeInTheDocument()
  })

  it('failed conveys the failure AND attributes it to WhatsApp (richer accessible name)', () => {
    const { container } = render(<WhatsappMessageStatus status='failed' />)
    const sr = container.querySelector('.sr-only')?.textContent ?? ''
    expect(sr).toContain('ההודעה לא נשלחה')
    expect(sr).toContain('הסטטוס התקבל מ־WhatsApp.')
  })

  it('every state carries a text label, so colour is never the only carrier', () => {
    for (const status of ['sent', 'delivered', 'read', 'failed'] as const) {
      const { container } = render(<WhatsappMessageStatus status={status} />)
      expect(container.querySelector('.sr-only')?.textContent?.length).toBeGreaterThan(0)
      cleanup()
    }
  })

  it('renders nothing for inbound rows', () => {
    const { container } = render(<WhatsappMessageStatus status='received' />)
    expect(container.firstChild).toBeNull()
  })

  it('uses no emoji', () => {
    for (const status of ['sent', 'delivered', 'read', 'failed'] as const) {
      const { container } = render(<WhatsappMessageStatus status={status} />)
      expect(container.textContent ?? '').not.toMatch(/\p{Extended_Pictographic}/u)
      cleanup()
    }
  })
})
