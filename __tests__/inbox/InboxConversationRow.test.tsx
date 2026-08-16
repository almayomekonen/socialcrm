// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/components/inbox/DeleteConversationMenu', () => ({ default: () => null }))

import InboxConversationRow from '@/modules/inbox/components/InboxConversationRow'
import type { InboxConversationListItem } from '@/modules/inbox/types'

const item = (over: Partial<InboxConversationListItem> = {}): InboxConversationListItem => ({
  conversationId: 9,
  leadId: 4,
  channel: 'whatsapp',
  displayName: 'נועה',
  leadName: 'נועה',
  leadStatus: 'new',
  lastMessageAt: '2026-08-16T11:00:00.000Z',
  lastInboundAt: '2026-08-16T05:00:00.000Z',
  lastHumanOutboundAt: null,
  lastDirection: 'inbound',
  lastMessagePreview: 'שאלה',
  unread: false,
  attention: 'needs_reply',
  waitingTitle: 'ממתין לתשובה שלך · 7 שעות',
  waitingWindowHint: 'נותרו 17 שעות בחלון WhatsApp',
  temperature: null,
  intent: null,
  suggestedAction: null,
  ...over,
})

describe('desktop Inbox conversation row', () => {
  it('shows waiting title + remaining window on a waiting WhatsApp row', () => {
    render(<InboxConversationRow item={item()} selected={false} />)
    expect(screen.getByText('ממתין לתשובה שלך · 7 שעות')).toBeTruthy()
    expect(screen.getByText('נותרו 17 שעות בחלון WhatsApp')).toBeTruthy()
  })

  it('shows closed-window copy when the window is closed', () => {
    render(
      <InboxConversationRow
        item={item({ waitingWindowHint: 'חלון WhatsApp נסגר' })}
        selected={false}
      />,
    )
    expect(screen.getByText('חלון WhatsApp נסגר')).toBeTruthy()
  })

  it('keeps non-waiting rows clean', () => {
    render(
      <InboxConversationRow
        item={item({
          attention: 'replied',
          waitingTitle: null,
          waitingWindowHint: null,
          lastDirection: 'outbound',
        })}
        selected={false}
      />,
    )
    expect(screen.queryByText(/ממתין לתשובה שלך/)).toBeNull()
    expect(screen.queryByText(/חלון WhatsApp/)).toBeNull()
  })
})
