// @vitest-environment jsdom
/**
 * Messenger UI states: tab visibility, window-closed state, message sources,
 * attachments and the unsupported-message fallback, unread rows, and no emoji.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/lib/useAction', () => ({
  useAction: () => ({ loading: false, error: null, setError: vi.fn(), run: (fn: () => unknown) => fn(), accessDenied: false }),
}))
vi.mock('@/modules/messenger/actions', () => ({
  sendMessengerReply: vi.fn(async () => ({ ok: true })),
  markMessengerConversationRead: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/modules/messenger/leadActions', () => ({
  createLeadFromMessengerConversation: vi.fn(),
  linkMessengerConversationToLead: vi.fn(),
}))
vi.mock('@/actions/clients', () => ({ searchLeads: vi.fn(async () => []) }))

import InboxChannelSwitch from '@/modules/inbox/components/InboxChannelSwitch'
import MessengerComposer from '@/modules/messenger/components/MessengerComposer'
import MessengerThread from '@/modules/messenger/components/MessengerThread'
import MessengerConversationRow from '@/modules/messenger/components/MessengerConversationRow'
import MessengerEmptyState from '@/modules/messenger/components/MessengerEmptyState'
import type { MessengerConversationListItem, MessengerMessage } from '@/modules/messenger/types'

afterEach(() => cleanup())

const conversation: MessengerConversationListItem = {
  id: 12,
  pageId: 'P1',
  customerName: 'דנה לוי',
  leadId: null,
  leadName: null,
  lastMessageAt: new Date('2026-09-14T10:00:00Z'),
  lastInboundAt: new Date('2026-09-14T10:00:00Z'),
  lastMessageText: 'כמה עולה?',
  lastDirection: 'inbound',
  unread: true,
  profilePicUrl: null,
  profileStatus: null,
}

const msg = (over: Partial<MessengerMessage>): MessengerMessage => ({
  id: 1,
  direction: 'inbound',
  source: 'customer',
  text: 'כמה עולה?',
  attachments: [],
  timestamp: new Date('2026-09-14T10:00:00Z'),
  deliveredAt: null,
  readAt: null,
  ...over,
})

describe('InboxChannelSwitch — Messenger tab', () => {
  it('is hidden unless Messenger is rolled out to the agency; existing callers are unchanged', () => {
    render(<InboxChannelSwitch active='whatsapp' />)
    expect(screen.queryByRole('link', { name: /Messenger/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })

  it('shows Messenger next to שיחות and תגובות when enabled', () => {
    render(<InboxChannelSwitch active='whatsapp' showMessenger />)
    expect(screen.getByRole('link', { name: /Messenger/ })).toHaveAttribute('href', '/inbox/messenger')
  })
})

describe('MessengerComposer', () => {
  it('outside the window: explains the 24-hour rule and offers no send control', () => {
    render(<MessengerComposer conversationId={12} windowOpen={false} windowHint={null} />)
    expect(screen.getByRole('status')).toHaveTextContent('חלון המענה נסגר')
    expect(screen.getByRole('status')).toHaveTextContent('24 שעות')
    expect(screen.queryByRole('button', { name: 'שלח הודעה' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('inside the window: labelled textbox, disabled send until there is text, and the server-computed hint', () => {
    render(<MessengerComposer conversationId={12} windowOpen windowHint='אפשר להשיב עוד כ-20 שעות' />)
    expect(screen.getByLabelText('תשובה ב-Messenger')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'שלח הודעה' })).toBeDisabled()
    expect(screen.getByText('אפשר להשיב עוד כ-20 שעות')).toBeInTheDocument()
  })
})

describe('MessengerThread', () => {
  const renderThread = (messages: MessengerMessage[], canSend = true) =>
    render(
      <MessengerThread
        conversation={conversation}
        messages={messages}
        windowOpen
        windowHint={null}
        canSend={canSend}
        permissionPrompt={<p>PROMPT</p>}
      />,
    )

  it('labels a reply sent from the Page inbox, and not one sent from SocialCRM', () => {
    renderThread([
      msg({ id: 1 }),
      msg({ id: 2, direction: 'outbound', source: 'page_inbox', text: 'ענינו מהתיבה' }),
      msg({ id: 3, direction: 'outbound', source: 'socialcrm', text: 'ענינו מהמערכת' }),
    ])
    expect(screen.getAllByText('נשלח מתיבת ההודעות של הדף')).toHaveLength(1)
  })

  it('renders images, links other files, and gives unsupported messages a clear fallback', () => {
    renderThread([
      msg({ id: 1, text: '', attachments: [{ type: 'image', url: 'https://lookaside.fbsbx.com/i.jpg' }] }),
      msg({ id: 2, text: '', attachments: [{ type: 'file', url: 'https://lookaside.fbsbx.com/f.pdf' }] }),
      msg({ id: 3, text: '', attachments: [{ type: 'unsupported', url: null }] }),
    ])
    expect(screen.getByAltText('תמונה שהתקבלה ב-Messenger')).toHaveAttribute('referrerpolicy', 'no-referrer')
    const file = screen.getByRole('link', { name: 'הורד קובץ מצורף' })
    expect(file).toHaveAttribute('rel', 'noopener noreferrer')
    expect(file).toHaveAttribute('download')
    expect(screen.getAllByText(/סוג הודעה שלא ניתן להציג כאן/).length).toBeGreaterThan(0)
  })

  it('audio and video are playable in place rather than linking out to Facebook', () => {
    renderThread([
      msg({ id: 1, text: '', attachments: [{ type: 'audio', url: 'https://lookaside.fbsbx.com/a.mp4' }] }),
      msg({ id: 2, text: '', attachments: [{ type: 'video', url: 'https://lookaside.fbsbx.com/v.mp4' }] }),
    ])
    expect(screen.getByLabelText('הקלטה שהתקבלה ב-Messenger')).toHaveAttribute('controls')
    expect(screen.getByLabelText('סרטון שהתקבל ב-Messenger')).toHaveAttribute('controls')
  })

  it('a sticker renders as a sticker, and shared content shows its link', () => {
    renderThread([
      msg({ id: 1, text: '', attachments: [{ type: 'image', url: 'https://cdn.example/s.png', sticker: true }] }),
      msg({ id: 2, text: '', attachments: [{ type: 'share', url: 'https://example.com/x', title: 'מאמר' }] }),
    ])
    expect(screen.getByAltText('מדבקה')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'מאמר' })).toHaveAttribute('href', 'https://example.com/x')
  })

  it('delivery state is shown only when Meta reported it — never assumed', () => {
    renderThread([
      msg({ id: 1, direction: 'outbound', source: 'socialcrm', text: 'א' }),
      msg({ id: 2, direction: 'outbound', source: 'socialcrm', text: 'ב', deliveredAt: new Date() }),
      msg({ id: 3, direction: 'outbound', source: 'socialcrm', text: 'ג', deliveredAt: new Date(), readAt: new Date() }),
    ])
    expect(screen.getByText('נשלח — ממתין לאישור מסירה')).toBeInTheDocument()
    expect(screen.getByText('נמסר')).toBeInTheDocument()
    expect(screen.getByText('נקרא')).toBeInTheDocument()
  })

  it('an inbound message never shows a delivery state', () => {
    renderThread([msg({ id: 1, direction: 'inbound', deliveredAt: new Date(), readAt: new Date() })])
    expect(screen.queryByText('נמסר')).not.toBeInTheDocument()
    expect(screen.queryByText('נקרא')).not.toBeInTheDocument()
  })

  it('a real profile picture is used, and a broken one falls back to initials without a broken image', async () => {
    const { default: MessengerAvatar } = await import('@/modules/messenger/components/MessengerAvatar')
    const { container } = render(<MessengerAvatar name='דנה לוי' picUrl='https://cdn.example/p.jpg' />)
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('src', 'https://cdn.example/p.jpg')
    fireEvent.error(img!)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('דל')
  })

  it('with no picture the avatar is initials, never a placeholder photo', async () => {
    const { default: MessengerAvatar } = await import('@/modules/messenger/components/MessengerAvatar')
    const { container } = render(<MessengerAvatar name='דנה לוי' picUrl={null} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('דל')
  })

  it('without pages_messaging the composer is replaced by the permission prompt', () => {
    renderThread([msg({})], false)
    expect(screen.getByText('PROMPT')).toBeInTheDocument()
    expect(screen.queryByLabelText('תשובה ב-Messenger')).not.toBeInTheDocument()
  })

  it('offers צור ליד and linking when no lead is attached; a linked lead is a link to it', () => {
    renderThread([msg({})])
    expect(screen.getByRole('button', { name: 'צור ליד' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /קשר לליד קיים/ })).toBeInTheDocument()
    cleanup()
    render(
      <MessengerThread
        conversation={{ ...conversation, leadId: 44, leadName: 'דנה לוי' }}
        messages={[msg({})]}
        windowOpen
        windowHint={null}
        canSend
        permissionPrompt={null}
      />,
    )
    expect(screen.getByRole('link', { name: 'פתח את הליד: דנה לוי' })).toHaveAttribute('href', '/clients/44/summary')
  })
})

describe('MessengerConversationRow and empty states', () => {
  it('an unread conversation says so in text, not by weight alone', () => {
    render(<MessengerConversationRow item={conversation} selected={false} />)
    expect(screen.getByText('לא נקרא')).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/inbox/messenger?c=12')
  })

  it('never shows the PSID or any raw Meta id', () => {
    const { container } = render(<MessengerConversationRow item={{ ...conversation, customerName: null }} selected={false} />)
    expect(container.textContent).toContain('פונה מ-Messenger')
    expect(container.textContent).not.toMatch(/\d{8,}/)
  })

  it('the not-connected state gives a next step; no emoji anywhere', () => {
    const { container } = render(<MessengerEmptyState kind='not-connected' />)
    expect(screen.getByRole('link', { name: 'חבר דף פייסבוק' })).toHaveAttribute('href', '/settings/integrations?section=facebook')
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})
