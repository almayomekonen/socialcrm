// @vitest-environment jsdom
//
// Captions, reactions and quoted replies, rendered by the DESKTOP thread and
// the MOBILE thread from one fixture. Both render the shared view
// (lib/inbox/whatsappThreadView.ts), so they must say the same things.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { LeadWhatsappMessage } from '@/db/inboxMessages'
import { UNSUPPORTED_MESSAGE_NOTICE } from '@/lib/inbox/attachmentDisplay'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/actions/whatsapp/sendWhatsappReply', () => ({ sendWhatsappReply: vi.fn() }))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
vi.mock('@/actions/whatsapp/templates/sendTemplateToLead', () => ({ sendTemplateToLead: vi.fn() }))
vi.mock('@/components/summary/WhatsappReplyDraft', () => ({ default: () => <div data-mock='reply' /> }))
vi.mock('@/components/summary/WhatsappNewMessageNotifier', () => ({ default: () => null }))
vi.mock('@/components/summary/WhatsappConversationHeader', () => ({ default: () => <div data-mock='header' /> }))
vi.mock('@/modules/inbox/components/ChannelIcon', () => ({ default: () => <span data-mock='chan' /> }))

import WhatsappConversation from '@/components/summary/WhatsappConversation'
import ConversationThreadMobile from '@/modules/inbox/mobile/ConversationThreadMobile'

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60 * 1000).toISOString()
const base = { status: 'received' as const, failureText: null, failureCategory: null, attachment: null }
const FIXTURE: LeadWhatsappMessage[] = [
  { ...base, id: 1, direction: 'outbound', status: 'read', type: 'text', text: 'מחיר החבילה 1200 ש"ח', timestamp: at(60) },
  { ...base, id: 2, direction: 'inbound', type: 'reaction', text: '', reaction: { emoji: '👍', targetId: 1, targetRef: 'a' }, timestamp: at(59) },
  { ...base, id: 3, direction: 'inbound', type: 'text', text: 'אפשר בתשלומים?', replyTo: { targetId: 1 }, timestamp: at(58) },
  { ...base, id: 4, direction: 'inbound', type: 'reaction', text: '', reaction: { emoji: '❤️', targetId: null, targetRef: 'old' }, timestamp: at(57) },
  { ...base, id: 5, direction: 'inbound', type: 'text', text: 'ועוד שאלה', replyTo: { targetId: null }, timestamp: at(56) },
  {
    ...base,
    id: 6,
    direction: 'inbound',
    type: 'image',
    text: '',
    caption: 'צילום של החדר',
    attachment: { filename: null, mimeType: 'image/jpeg' },
    timestamp: at(55),
  },
  { ...base, id: 7, direction: 'inbound', type: 'reaction', text: '', reaction: { emoji: null, targetId: 3, targetRef: 'b' }, timestamp: at(54) },
]

const surfaces = {
  desktop: () => render(<WhatsappConversation messages={FIXTURE} leadId={1} conversationId={1} />),
  mobile: () =>
    render(
      <ConversationThreadMobile
        conversationId={1}
        leadId={9}
        displayName='נועה'
        initialMessages={FIXTURE}
        composerFacts={{ health: 'operational', templatesEnabled: false, templates: [], canManageTemplates: false }}
      />,
    ),
}

for (const [name, mount] of Object.entries(surfaces)) {
  describe(`${name} thread`, () => {
    it('no reaction row renders as a bubble or as the unsupported notice', () => {
      mount()
      expect(screen.queryByText(UNSUPPORTED_MESSAGE_NOTICE)).toBeNull()
      expect(document.body.textContent).not.toContain('—')
    })

    it('a reaction sits on its message, with an accessible label', () => {
      mount()
      const lists = screen.getAllByRole('list', { name: 'תגובות להודעה' })
      expect(lists).toHaveLength(1)
      expect(within(lists[0]).getByText(/תגובה נכנסת/)).toBeInTheDocument()
      expect(lists[0].textContent).toContain('👍')
    })

    it('a reaction to a message not in the thread is a line of its own; a removed reaction shows nothing', () => {
      mount()
      const notes = screen.getAllByText(/על הודעה קודמת/)
      expect(notes).toHaveLength(1)
      expect(notes[0].textContent).toContain('❤️')
      expect(notes[0].textContent).toContain('תגובה נכנסת')
    })

    it('replies quote their message, or say it is an earlier one', () => {
      mount()
      expect(screen.getByText('מחיר החבילה 1200 ש"ח', { selector: 'p.truncate' })).toBeInTheDocument()
      expect(screen.getByText('תגובה להודעה קודמת')).toBeInTheDocument()
      expect(screen.getAllByText('ציטוט:', { exact: false })).toHaveLength(2)
    })

    it('a photo caption is shown', () => {
      mount()
      expect(screen.getByText('צילום של החדר')).toBeInTheDocument()
    })
  })
}

it('both surfaces show the same reactions, quotes and captions', () => {
  const read = () => ({
    chips: screen.getAllByRole('list', { name: 'תגובות להודעה' }).map((l) => l.textContent),
    notes: screen.getAllByText(/על הודעה קודמת/).map((n) => n.textContent?.replace(/\s+/g, ' ').trim()),
    quotes: screen.getAllByText(/ציטוט:/).map((q) => q.textContent?.trim()),
    caption: screen.queryByText('צילום של החדר') !== null,
  })
  surfaces.desktop()
  const desktop = read()
  cleanup()
  surfaces.mobile()
  expect(read()).toEqual(desktop)
})
