// @vitest-environment jsdom
//
// Lead → WhatsApp action routing, mobile and desktop.
//
// THE DEFECT THIS LOCKS DOWN. The mobile action used to answer "no WhatsApp
// connection" with `window.open(wa.me)` from inside an `onUnavailable` hook that
// ran AFTER an awaited server action. By then the browser's transient user
// activation was spent, so mobile suppressed the popup and the first tap did
// nothing at all — not even a toast, because the wa.me branch returned before
// the toast could run. Reproduced on device: tap once, nothing; tap again, the
// phone leaves SocialCRM for WhatsApp.
//
// The product decision: never leave the product. Connected → the SocialCRM
// conversation. Not connected → the WhatsApp connect UI.
//
// Runs without a database (VITEST_NO_DB=1).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const push = vi.fn()
const toastFn = vi.fn()
const resolveConversation = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: () => {}, refresh: () => {} }),
  usePathname: () => '/clients/1531/summary',
}))
vi.mock('@/lib/toast', () => ({ toast: (...args: unknown[]) => toastFn(...args) }))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({
  recordLeadActionEvent: vi.fn(async () => {}),
}))
vi.mock('@/modules/inbox/actions', () => ({
  resolveLeadWhatsappConversation: (...args: unknown[]) => resolveConversation(...args),
}))
vi.mock('@/actions/clients', () => ({ deleteLead: vi.fn(async () => ({ ok: true })) }))

import LeadContactActions from '@/modules/leads/mobile/LeadContactActions'
import LeadOverflowSheet from '@/modules/leads/mobile/LeadOverflowSheet'
import { openLeadWhatsappInInbox, WHATSAPP_CONNECT_HREF } from '@/modules/inbox/client/openLeadWhatsapp'

const WA_BUTTON = { name: 'וואטסאפ לדני לוי' }
const SETTINGS_HREF = '/settings/integrations?section=whatsapp'

beforeEach(() => {
  push.mockClear()
  toastFn.mockClear()
  resolveConversation.mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const mobileBar = () =>
  render(<LeadContactActions leadId={1531} phone='0541234567' name='דני לוי' size='bar' />)

describe('mobile WhatsApp action', () => {
  it('WA-1: connected → navigates to the SocialCRM inbox conversation', async () => {
    resolveConversation.mockResolvedValue({ conversationId: 88 })
    mobileBar()

    fireEvent.click(screen.getByRole('button', WA_BUTTON))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/inbox?conversation=88'))
    expect(push).not.toHaveBeenCalledWith(SETTINGS_HREF)
    expect(toastFn).not.toHaveBeenCalled()
  })

  it('WA-2: NOT connected → navigates to Settings with the WhatsApp accordion open', async () => {
    resolveConversation.mockResolvedValue({ conversationId: null, reason: 'no-connection' })
    mobileBar()

    fireEvent.click(screen.getByRole('button', WA_BUTTON))

    await waitFor(() => expect(push).toHaveBeenCalledWith(SETTINGS_HREF))
    // The whole point: the rep stays inside SocialCRM.
    expect(toastFn).not.toHaveBeenCalled()
  })

  it('WA-3: NOT connected → never calls window.open, and never builds a wa.me URL', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    resolveConversation.mockResolvedValue({ conversationId: null, reason: 'no-connection' })
    mobileBar()

    fireEvent.click(screen.getByRole('button', WA_BUTTON))

    await waitFor(() => expect(push).toHaveBeenCalledWith(SETTINGS_HREF))
    // This is the regression guard for the first-tap failure: window.open after
    // an await is gesture-gated, so it must not be on this path at all.
    expect(openSpy).not.toHaveBeenCalled()
    expect(push.mock.calls.flat().join(' ')).not.toContain('wa.me')
  })

  it('WA-4: a single tap is enough — one click produces the navigation', async () => {
    resolveConversation.mockResolvedValue({ conversationId: null, reason: 'no-connection' })
    mobileBar()

    fireEvent.click(screen.getByRole('button', WA_BUTTON))

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    expect(push).toHaveBeenCalledWith(SETTINGS_HREF)
  })

  it('WA-5: a lead with no valid number still gets an explanation, not a redirect', async () => {
    resolveConversation.mockResolvedValue({ conversationId: null, reason: 'no-recipient' })
    mobileBar()

    fireEvent.click(screen.getByRole('button', WA_BUTTON))

    await waitFor(() => expect(toastFn).toHaveBeenCalled())
    expect(push).not.toHaveBeenCalled()
  })

  it('WA-6 (mobile regression): with no phone the action is absent, never a dead button', () => {
    render(<LeadContactActions leadId={1531} phone={null} name='דני לוי' size='bar' />)
    expect(screen.queryByRole('button', { name: /וואטסאפ/ })).toBeNull()
  })
})

describe('desktop WhatsApp action (regression — unchanged)', () => {
  it('WA-7: connected → pushes the inbox conversation, exactly as before', async () => {
    resolveConversation.mockResolvedValue({ conversationId: 12 })

    await openLeadWhatsappInInbox(1531, push)

    expect(push).toHaveBeenCalledWith('/inbox?conversation=12')
    expect(toastFn).not.toHaveBeenCalled()
  })

  it('WA-8: NOT connected and no handler → toast, NOT a redirect (desktop preserved)', async () => {
    resolveConversation.mockResolvedValue({ conversationId: null, reason: 'no-connection' })

    await openLeadWhatsappInInbox(1531, push)

    expect(toastFn).toHaveBeenCalledWith('message', 'יש לחבר WhatsApp בהגדרות לפני פתיחת שיחה')
    expect(push).not.toHaveBeenCalled()
  })

  it('WA-9: only no-connection is delegable — a caller cannot reinterpret other reasons', async () => {
    const onNoConnection = vi.fn()
    resolveConversation.mockResolvedValue({ conversationId: null, reason: 'no-recipient' })

    await openLeadWhatsappInInbox(1531, push, { onNoConnection })

    expect(onNoConnection).not.toHaveBeenCalled()
    expect(toastFn).toHaveBeenCalledWith('message', 'לליד אין מספר טלפון תקין לשיחת WhatsApp')
  })
})

/**
 * The same product rule has to hold on EVERY mobile entry point, not just the
 * sticky bar. `origin/main` grew two more callers (the list overflow sheet and
 * the multi-select action bar) that each carried their own copy of the wa.me
 * fallback — the typecheck is what surfaced them, and these lock them down.
 */
describe('lead overflow sheet — same rule', () => {
  const openSheet = () => {
    render(
      <LeadOverflowSheet leadId={1531} name='דני לוי' phone='0541234567' onStatus={() => {}} onFollowUp={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /פעולות|עוד/ }))
  }

  it('WA-10: the connect href is a single shared constant, not copied per call site', () => {
    expect(WHATSAPP_CONNECT_HREF).toBe(SETTINGS_HREF)
  })

  it('WA-11: NOT connected → Settings, and window.open is never called', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    resolveConversation.mockResolvedValue({ conversationId: null, reason: 'no-connection' })
    openSheet()

    fireEvent.click(screen.getByRole('button', { name: 'פתיחת שיחה' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith(SETTINGS_HREF))
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('WA-12: connected → the SocialCRM conversation', async () => {
    resolveConversation.mockResolvedValue({ conversationId: 77 })
    openSheet()

    fireEvent.click(screen.getByRole('button', { name: 'פתיחת שיחה' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/inbox?conversation=77'))
  })

  it('WA-13: no phone → the conversation action is absent', () => {
    render(
      <LeadOverflowSheet leadId={1531} name='דני לוי' phone={null} onStatus={() => {}} onFollowUp={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /פעולות|עוד/ }))
    expect(screen.queryByRole('button', { name: 'פתיחת שיחה' })).toBeNull()
  })
})
