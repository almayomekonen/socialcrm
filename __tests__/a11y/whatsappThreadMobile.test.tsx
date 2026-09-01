// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import '@testing-library/jest-dom/vitest'
import MessageBubbleMobile from '@/modules/inbox/mobile/MessageBubbleMobile'
import ConversationThreadMobile from '@/modules/inbox/mobile/ConversationThreadMobile'
import type { LeadWhatsappMessage } from '@/db/inboxMessages'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))
vi.mock('@/actions/whatsapp/sendWhatsappReply', () => ({ sendWhatsappReply: vi.fn() }))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
vi.mock('@/actions/whatsapp/templates/sendTemplateToLead', () => ({ sendTemplateToLead: vi.fn() }))

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(cleanup)

/**
 * RELATIVE, NOT A FIXED DATE. The composer only renders a text box while Meta's
 * 24-hour customer-service window is open, and that window is resolved against
 * the real clock. A hardcoded timestamp therefore made these assertions pass
 * only for 24 hours after the date someone typed, then fail forever — which is
 * exactly what happened to the send-button test. Two hours ago is always inside
 * the window, so the test asserts what it means to assert (an OPEN window) in a
 * way that does not rot.
 */
const msg = (over: Partial<LeadWhatsappMessage> = {}): LeadWhatsappMessage => ({
  id: 1,
  direction: 'inbound',
  type: 'text',
  text: 'שלום',
  timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  status: 'received',
  attachment: null,
  failureText: null,
  failureCategory: null,
  ...over,
})

describe('mobile WhatsApp thread visual language', () => {
  it('incoming bubbles are white; outgoing are WhatsApp green, not brand purple', () => {
    const { rerender } = render(<MessageBubbleMobile message={msg()} onOpen={() => {}} />)
    expect(screen.getByTestId('message-bubble').className).toContain('bg-white')
    expect(screen.getByTestId('message-bubble').className).not.toContain('primary-tint')

    rerender(
      <MessageBubbleMobile
        message={msg({ id: 2, direction: 'outbound', status: 'delivered', text: 'היי' })}
        onOpen={() => {}}
      />,
    )
    expect(screen.getByTestId('message-bubble').className).toContain('bg-[#d9fdd3]')
    expect(screen.getByTestId('message-bubble').className).not.toContain('primary-tint')
    expect(screen.getByTestId('message-bubble').className).not.toContain('bg-solid')
  })

  it('shows timestamps and outbound delivery ticks from existing status only', () => {
    render(
      <MessageBubbleMobile
        message={msg({ direction: 'outbound', status: 'read', text: 'נשלח' })}
        onOpen={() => {}}
      />,
    )
    expect(screen.getByText('נקרא')).toBeTruthy()
    expect(screen.getByTestId('message-bubble').textContent).toMatch(/\d{2}:\d{2}/)
  })

  it('thread wallpaper and send control use WhatsApp green, not CRM purple', () => {
    render(
      <ConversationThreadMobile
        conversationId={1}
        leadId={9}
        displayName='נועה'
        initialMessages={[msg()]}
        composerFacts={{ health: 'operational', templatesEnabled: false, templates: [], canManageTemplates: false }}
      />,
    )
    expect(screen.getByTestId('wa-thread').className).toContain('bg-[#ece5dd]')
    const send = screen.getByRole('button', { name: 'שלח' })
    expect(send.className).toContain('bg-[#25D366]')
    expect(send.className).not.toContain('bg-solid')
    expect(screen.getByRole('textbox', { name: 'כתיבת הודעה' }).className).toMatch(/text-base/)
    expect(screen.getByTestId('wa-thread-scroller')).toBeTruthy()
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })
})

describe('desktop WhatsApp conversation is unchanged', () => {
  it('still uses the CRM success tokens, not the mobile WhatsApp greens', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'components/summary/WhatsappConversation.tsx'), 'utf8')
    expect(src).toContain('bg-success-bg')
    expect(src).toContain('primary-soft')
    expect(src).not.toContain('#d9fdd3')
    expect(src).not.toContain('#ece5dd')
    expect(src).not.toContain('#008069')
  })

  it('hides the shell שיחות header only when the WhatsApp thread chrome is mounted', () => {
    const shell = fs.readFileSync(path.join(process.cwd(), 'components/mobile/MobileWorkspaceShell.tsx'), 'utf8')
    expect(shell).toContain('has-[[data-wa-thread-chrome]]:[&_[data-mobile-header]]:hidden')
    expect(shell).toContain('has-[[data-wa-thread-chrome]]:[&_#main-content]:overflow-hidden')
    // `main` must not contain overscroll while it is a zero-slack ancestor of
    // the thread scroller — that is the second half of the stuck-scroll fix.
    expect(shell).toContain('has-[[data-wa-thread-chrome]]:[&_#main-content]:overscroll-auto')
    expect(shell).toContain('flex min-h-0 flex-1 flex-col overflow-hidden')
    expect(shell).not.toMatch(/className='flex h-dvh flex-col/)
    expect(shell).toContain('flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain')
    const route = fs.readFileSync(path.join(process.cwd(), 'modules/inbox/mobile/MobileInboxRoute.tsx'), 'utf8')
    expect(route).toContain('data-wa-thread-chrome')
    // Back must return to the list the rep came from, search included — a bare
    // '/inbox' discards an active search and reads as the app losing their place.
    expect(route).toContain('const backHref = q ?')
    expect(route).toContain('href={backHref as Route}')
    expect(route).toContain("tone='onGreen'")
    expect(route).toContain('MobileInboxReadMarker')
    const list = fs.readFileSync(path.join(process.cwd(), 'modules/inbox/mobile/ConversationListMobile.tsx'), 'utf8')
    expect(list).not.toContain('data-wa-thread-chrome')
    const css = fs.readFileSync(path.join(process.cwd(), 'lib/css/main.css'), 'utf8')
    expect(css).toContain('html:has([data-mobile-workspace])')
    expect(css).not.toMatch(/html:has\(\[data-mobile-workspace\]\)[\s\S]{0,180}overscroll-behavior:\s*none/)
  })

  it('tab bar is a flex sibling, not sticky, so it cannot detach from the thread', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'components/mobile/MobileTabBar.tsx'), 'utf8')
    expect(src).not.toContain('sticky')
    expect(src).toContain('shrink-0')
  })

  it('scrolls the message list itself, not the document or scrollIntoView ancestors', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'modules/inbox/mobile/ConversationThreadMobile.tsx'), 'utf8')
    expect(src).not.toMatch(/\.scrollIntoView\s*\(/)
    expect(src).not.toContain('window.scrollTo')
    expect(src).toContain('list.scrollTop = list.scrollHeight')
    expect(src).toContain('flex min-h-0 flex-1 flex-col overflow-hidden')
    expect(src).not.toMatch(/className='flex h-full/)
    expect(src).not.toContain('safe-area-inset-bottom')
  })
})
