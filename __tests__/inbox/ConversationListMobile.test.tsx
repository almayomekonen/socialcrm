// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/inbox',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/modules/inbox/actions', () => ({
  deleteConversation: vi.fn(async () => ({ ok: true, deleted: true })),
  markConversationRead: vi.fn(async () => ({ ok: true })),
  loadMoreInboxConversations: vi.fn(async () => ({ items: [], nextCursor: null })),
}))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

import ConversationListMobile from '@/modules/inbox/mobile/ConversationListMobile'
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

describe('mobile Inbox conversation list', () => {
  it('shows the same waiting copy as desktop', () => {
    render(<ConversationListMobile items={[item()]} q='' nextCursor={null} formatWhen={() => 'לפני 7 שעות'} />)
    expect(screen.getByText('ממתין לתשובה שלך · 7 שעות')).toBeTruthy()
    expect(screen.getByText('נותרו 17 שעות בחלון WhatsApp')).toBeTruthy()
    expect(screen.getByRole('link').getAttribute('href')).toBe('/inbox?conversation=9')
  })

  it('does not add waiting chrome to a normal row', () => {
    render(
      <ConversationListMobile
        items={[item({ waitingTitle: null, waitingWindowHint: null, attention: null })]}
        q=''
        nextCursor={null}
        formatWhen={() => 'לפני שעה'}
      />,
    )
    expect(screen.queryByText(/ממתין לתשובה שלך/)).toBeNull()
    expect(screen.queryByText(/חלון WhatsApp/)).toBeNull()
  })
})
