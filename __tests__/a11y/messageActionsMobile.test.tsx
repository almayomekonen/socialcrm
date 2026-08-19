// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ConversationThreadMobile from '@/modules/inbox/mobile/ConversationThreadMobile'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))
vi.mock('@/actions/whatsapp/sendWhatsappReply', () => ({ sendWhatsappReply: vi.fn() }))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
vi.mock('@/actions/whatsapp/templates/sendTemplateToLead', () => ({ sendTemplateToLead: vi.fn() }))

const writeText = vi.fn(async () => {})

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Object.assign(navigator, { clipboard: { writeText } })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('mobile message long-press', () => {
  it('opens a copy sheet and does not offer edit or delete', async () => {
    render(
      <ConversationThreadMobile
        conversationId={44}
        leadId={9}
        displayName='נועה'
        initialMessages={[
          {
            id: 1,
            direction: 'inbound',
            type: 'text',
            text: 'היי מה קורה',
            timestamp: new Date().toISOString(),
            status: 'received',
            failureText: null,
            failureCategory: null,
          },
        ]}
        composerFacts={{ health: 'operational', templatesEnabled: false, templates: [], canManageTemplates: false }}
      />,
    )
    fireEvent.contextMenu(screen.getByTestId('message-bubble'))
    expect(screen.getByRole('dialog', { name: 'פעולות הודעה' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'העתק' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'ערוך' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'מחק' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'העתק' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('היי מה קורה'))
  })
})
