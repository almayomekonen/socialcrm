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
// THE PRODUCT DECISION, AS IT NOW STANDS. Connected (or unknown) → the
// SocialCRM conversation, unchanged. NOT connected → hand the rep to WhatsApp
// itself with this lead's number.
//
// The earlier rule was "never leave the product", and it cost us the thing the
// product exists for: in production five businesses tapped this control nine
// times and produced zero conversations, because every tap ended on a settings
// page. The fallback is back — but shaped so the original defect cannot return.
// The decision is made SYNCHRONOUSLY at render (`resolveLeadContactPlan`, no
// I/O) and the control is a real anchor, so the browser follows it on the first
// tap with no gesture to spend. `window.open`-after-await is what these tests
// still forbid, and that guard is unchanged.
//
// Surfaces that do NOT pass `whatsappConnected` keep the old behaviour exactly —
// WA-1..WA-8 below are those surfaces, and they are untouched on purpose.
//
// Runs without a database (VITEST_NO_DB=1).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const push = vi.fn()
const toastFn = vi.fn()
const resolveConversation = vi.fn()
const recordEvent = vi.fn(async (..._args: unknown[]) => {})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: () => {}, refresh: () => {} }),
  usePathname: () => '/clients/1531/summary',
}))
vi.mock('@/lib/toast', () => ({ toast: (...args: unknown[]) => toastFn(...args) }))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({
  recordLeadActionEvent: (...args: unknown[]) => recordEvent(...args),
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
  recordEvent.mockClear()
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

/**
 * THE ACTIVATION EXPERIMENT — the native handoff, and the triad that measures it.
 *
 * Everything above this line describes surfaces that do NOT know the workspace
 * connection state and therefore keep their previous behaviour. Everything below
 * passes `whatsappConnected` explicitly, which is what opts a surface in.
 */
const events = (name: string) =>
  recordEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1] as Record<string, unknown>)

const WA_LINK = { name: 'וואטסאפ לדני לוי' }

describe('native WhatsApp fallback (not connected)', () => {
  it('NF-1: not connected + valid phone → a real wa.me ANCHOR, not a button', () => {
    render(<LeadContactActions leadId={1531} phone='0541234567' name='דני לוי' size='bar' whatsappConnected={false} />)

    const link = screen.getByRole('link', WA_LINK)
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('https://wa.me/972541234567')
    // The in-app path must not even be consulted: no server round-trip at all.
    expect(resolveConversation).not.toHaveBeenCalled()
  })

  it('NF-2: the row variant is an anchor too, so a list row opens on the first tap', () => {
    render(<LeadContactActions leadId={1531} phone='0541234567' name='דני לוי' whatsappConnected={false} />)
    expect(screen.getByRole('link', WA_LINK).getAttribute('href')).toBe('https://wa.me/972541234567')
  })

  it('NF-3: MOBILE REGRESSION GUARD — the handoff never uses window.open', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<LeadContactActions leadId={1531} phone='0541234567' name='דני לוי' size='bar' whatsappConnected={false} />)

    fireEvent.click(screen.getByRole('link', WA_LINK))

    // The original defect: window.open after an awaited action is gesture-gated
    // and silently did nothing on the first tap. The anchor's own href replaces
    // it entirely, so window.open must not appear on this path.
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('NF-4: the tap emits clicked + succeeded(whatsapp_native), and nothing else', () => {
    render(<LeadContactActions leadId={1531} phone='0541234567' name='דני לוי' size='bar' whatsappConnected={false} />)

    fireEvent.click(screen.getByRole('link', WA_LINK))

    expect(events('lead_contact_clicked')).toEqual([
      { leadId: 1531, surface: 'mobile', intendedChannel: 'whatsapp_native' },
    ])
    expect(events('lead_contact_succeeded')).toEqual([
      { leadId: 1531, surface: 'mobile', channel: 'whatsapp_native' },
    ])
    expect(events('lead_contact_blocked')).toEqual([])
  })

  it('NF-5: an unusable number never renders a wa.me anchor, and blocks cleanly', () => {
    // Present but not normalisable — the case `if (!phone) return null` misses.
    render(<LeadContactActions leadId={1531} phone='123' name='דני לוי' size='bar' whatsappConnected={false} />)

    expect(screen.queryByRole('link', WA_LINK)).toBeNull()
    const btn = screen.getByRole('button', WA_LINK)
    fireEvent.click(btn)

    expect(events('lead_contact_blocked')).toEqual([{ leadId: 1531, surface: 'mobile', reason: 'no_phone' }])
    expect(events('lead_contact_succeeded')).toEqual([])
    expect(document.querySelectorAll('a[href*="wa.me"]').length).toBe(0)
  })
})

describe('connected path is untouched by the experiment', () => {
  it('NF-6: connected + open window → still the in-app conversation, still a button', async () => {
    resolveConversation.mockResolvedValue({ conversationId: 88 })
    render(<LeadContactActions leadId={1531} phone='0541234567' name='דני לוי' size='bar' whatsappConnected={true} />)

    // No anchor: a connected workspace never gets the handoff.
    expect(screen.queryByRole('link', WA_LINK)).toBeNull()
    fireEvent.click(screen.getByRole('button', WA_LINK))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/inbox?conversation=88'))
    expect(document.querySelectorAll('a[href*="wa.me"]').length).toBe(0)
    expect(events('lead_contact_succeeded')).toEqual([
      { leadId: 1531, surface: 'mobile', channel: 'whatsapp_api' },
    ])
  })

  it('NF-7: the triad invariant — one click resolves to exactly one terminal', async () => {
    resolveConversation.mockResolvedValue({ conversationId: 88 })
    render(<LeadContactActions leadId={1531} phone='0541234567' name='דני לוי' size='bar' whatsappConnected={true} />)

    fireEvent.click(screen.getByRole('button', WA_LINK))

    await waitFor(() => expect(events('lead_contact_succeeded')).toHaveLength(1))
    expect(events('lead_contact_clicked')).toHaveLength(1)
    expect(events('lead_contact_blocked')).toHaveLength(0)
  })
})

describe('the undefined-prop contract', () => {
  /**
   * Every lead-contact surface in the product now passes `whatsappConnected`.
   * This pins what happens when one does NOT — a new render site, a test
   * fixture, a future refactor that forgets it.
   *
   * `undefined` must mean "keep the in-app path", never "assume disconnected".
   * The opposite default would route people out of the product by omission,
   * which is the wrong way round for a change of this kind. `LeadListMobile`
   * once defaulted this prop to `false` and that is exactly the bug it caused.
   */
  it('NF-8: no whatsappConnected prop → BUTTON, no href, no wa.me anchor', () => {
    render(<LeadContactActions leadId={1531} phone='0541234567' name='דני לוי' size='bar' />)

    const btn = screen.getByRole('button', WA_LINK)
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.getAttribute('href')).toBeNull()
    expect(screen.queryByRole('link', WA_LINK)).toBeNull()
    expect(document.querySelectorAll('a[href*="wa.me"]').length).toBe(0)
  })
})
