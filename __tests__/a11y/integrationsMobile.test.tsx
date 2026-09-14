// @vitest-environment jsdom
//
// P0-E — mobile Integrations landing. Status cards, not the desktop accordion.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import '@testing-library/jest-dom/vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/settings/integrations',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/facebook/useEmbeddedSignup', () => ({
  useEmbeddedSignup: () => ({ launch: vi.fn() }),
}))

import IntegrationsLanding from '@/modules/settings/mobile/IntegrationsLanding'
import { facebookLandingCopy, readyMessagesLandingCopy, whatsappLandingCopy } from '@/modules/settings/mobile/integrationStatus'
import type { IntegrationsLandingProps } from '@/modules/settings/mobile/IntegrationsLanding'

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation((url: RequestInfo) => {
    const href = String(url)
    if (href.includes('/api/auth/facebook/connect') || href.includes('/api/auth/whatsapp/connect')) {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) })
    }
    return Promise.resolve({ ok: true, json: async () => ({ connected: false }) })
  }) as unknown as typeof fetch
})

afterEach(async () => {
  cleanup()
  await Promise.resolve()
})

const base = (): IntegrationsLandingProps => ({
  initialSheet: null,
  whatsapp: {
    connection: null,
    pendingPhones: null,
    appId: '',
    configId: '',
    graphVersion: 'v21.0',
    status: 'disconnected',
  },
  facebook: {
    connection: null,
    pendingPages: null,
    health: null,
  },
  templates: {
    enabled: true,
    connected: false,
    messagingReady: false,
    total: 0,
    approved: 0,
    pending: 0,
  },
  calendar: {
    state: 'not_connected',
    email: null,
    lastError: null,
  },
  websiteVisible: false,
})

describe('whatsappLandingCopy', () => {
  it('disconnected is neutral, not a grey “everything is off” wall of copy', () => {
    const copy = whatsappLandingCopy({ connected: false, status: 'disconnected' })
    expect(copy.statusLabel).toBe('לא מחובר')
    expect(copy.actionLabel).toContain('וואטסאפ')
    expect(copy.role).toBe('neutral')
  })

  it('operational is success with a manage action', () => {
    const copy = whatsappLandingCopy({ connected: true, status: 'operational' })
    expect(copy.statusLabel).toBe('מחובר')
    expect(copy.role).toBe('success')
    expect(copy.actionLabel).toBe('ניהול')
  })

  it('token health surfaces the existing expired notice, not a green claim', () => {
    const copy = whatsappLandingCopy({ connected: true, status: 'token' })
    expect(copy.role).toBe('error')
    expect(copy.statusLabel).toContain('פג')
  })

  /**
   * Throttled (#80008) is a transient Meta rate limit on our STATUS PROBE. The
   * connection works and messages keep flowing, so the card must not dress it as
   * something needing attention, and must not hand the owner a button for a
   * state that asks nothing of them. Before this branch existed it fell through
   * to the generic mapping and became `role: 'warning'` with the generic
   * "ניהול" action.
   */
  describe('throttled (#80008)', () => {
    const copy = () => whatsappLandingCopy({ connected: true, status: 'throttled' })

    it('1 · renders neutrally, not as a warning or an error', () => {
      expect(copy().role).toBe('info')
      expect(copy().role).not.toBe('warning')
      expect(copy().role).not.toBe('error')
    })

    it('2 · carries NO action at all', () => {
      expect(copy().actionLabel).toBeUndefined()
    })

    it('3 · does not fall through to the generic "ניהול" action', () => {
      expect(copy().actionLabel).not.toBe('ניהול')
    })

    it('keeps the calm copy and never asks the owner to reconnect', () => {
      expect(copy().statusLabel).toBe('החיבור תקין — בדיקת הסטטוס מוגבלת זמנית')
      expect(copy().statusLabel).not.toMatch(/צריך לאמת/)
      expect(copy().explanation).not.toMatch(/לחבר מחדש/)
    })

    it('4 · leaves genuine token and disconnected states untouched', () => {
      const token = whatsappLandingCopy({ connected: true, status: 'token' })
      expect(token.role).toBe('error')
      expect(token.actionLabel).toBeDefined()

      const off = whatsappLandingCopy({ connected: false, status: 'disconnected' })
      expect(off.role).toBe('neutral')
      expect(off.actionLabel).toContain('וואטסאפ')

      const ok = whatsappLandingCopy({ connected: true, status: 'operational' })
      expect(ok.role).toBe('success')
      expect(ok.actionLabel).toBe('ניהול')
    })
  })
})

describe('facebookLandingCopy', () => {
  it('names the connected page when healthy', () => {
    const copy = facebookLandingCopy({
      connection: { pageName: 'העסק של דנה' },
      health: { tokenValid: true, permissionsOk: true, subscribed: true, needsReconnect: false, errors: [] },
    })
    expect(copy.statusLabel).toBe('מחובר')
    expect(copy.explanation).toContain('העסק של דנה')
    expect(copy.role).toBe('success')
  })
})

describe('readyMessagesLandingCopy', () => {
  it('returns null when the existing agency flag is off — no new plan policy', () => {
    expect(
      readyMessagesLandingCopy({
        enabled: false,
        connected: true,
        messagingReady: true,
        total: 3,
        approved: 3,
        pending: 0,
      }),
    ).toBeNull()
  })

  it('empty connected workspace offers create', () => {
    const copy = readyMessagesLandingCopy({
      enabled: true,
      connected: true,
      messagingReady: true,
      total: 0,
      approved: 0,
      pending: 0,
    })
    expect(copy?.statusLabel).toBe('אין הודעות')
    expect(copy?.actionLabel).toContain('הודעה מוכנה')
  })
})

describe('IntegrationsLanding', () => {
  it('renders status cards, not the desktop accordion', () => {
    const { container } = render(<IntegrationsLanding {...base()} />)
    expect(screen.getByTestId('integrations-mobile')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'אינטגרציות' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'וואטסאפ' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'פייסבוק ואינסטגרם' })).toBeTruthy()
    expect(container.querySelector('.accordion')).toBeNull()
    expect(container.querySelectorAll('table')).toHaveLength(0)
  })

  it('uses brand-coloured badges, not a grey icon wall', () => {
    const { container } = render(<IntegrationsLanding {...base()} />)
    expect(container.innerHTML).toContain('bg-[#25D366]')
    expect(container.innerHTML).toContain('bg-[#1877F2]')
  })

  it('hides Ready Messages when the existing flag is off', () => {
    render(<IntegrationsLanding {...base()} templates={{ ...base().templates, enabled: false }} />)
    expect(screen.queryByRole('heading', { name: 'הודעות מוכנות' })).toBeNull()
  })

  /**
   * MOBILE-ONLY copy. The rep normally lands here by tapping WhatsApp on a lead,
   * so the not-connected sheet names the blocker and the outbound benefit. The
   * desktop settings copy is unchanged — WhatsappConnect defaults to it and only
   * this mobile caller overrides. The manage-state title is pinned by the
   * 'connected WhatsApp shows מחובר and opens manage' test below.
   */
  it('opens the existing WhatsApp connect UI in a sheet, with the mobile connect copy', async () => {
    render(<IntegrationsLanding {...base()} />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'חבר וואטסאפ' }))
    expect(screen.getByRole('dialog', { name: 'חיבור WhatsApp נדרש' })).toBeTruthy()
    expect(screen.getByText(/כדי לשלוח הודעות ללידים ישירות מ־SocialCRM/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'חבר WhatsApp עסקי' })).toBeTruthy()
  })

  it('connected WhatsApp shows מחובר and opens manage', async () => {
    render(
      <IntegrationsLanding
        {...base()}
        whatsapp={{ ...base().whatsapp, connection: { phoneNumberId: '123' }, status: 'operational' }}
      />,
    )
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.getAllByText('מחובר').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'ניהול' }))
    expect(screen.getByRole('dialog', { name: 'וואטסאפ' })).toBeTruthy()
  })

  it('Facebook OAuth return with one pending page auto-completes without a second Connect tap', async () => {
    render(
      <IntegrationsLanding
        {...base()}
        initialSheet='facebook'
        oauthQuery={{ select: '1' }}
        facebook={{
          ...base().facebook,
          pendingPages: [{ id: 'page-1', name: 'דף הבדיקה' }],
        }}
      />,
    )

    expect(screen.queryByRole('button', { name: /^חבר פייסבוק$/ })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'פייסבוק ואינסטגרם' })).toBeTruthy()
    expect(screen.getAllByText('משלים חיבור...').length).toBeGreaterThan(0)

    await waitFor(() => {
      const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      expect(calls.some((c) => String(c[0]).includes('/api/auth/facebook/connect'))).toBe(true)
    })
    const connectCall = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[0]).includes('/api/auth/facebook/connect'),
    )
    expect(connectCall?.[1]).toMatchObject({ method: 'POST' })
    // The Page id only: the token never reaches the client, so it cannot be posted back.
    expect(JSON.parse((connectCall?.[1] as RequestInit).body as string)).toEqual({ pageId: 'page-1' })
    expect(screen.queryByText('בחר את הדף שברצונך לחבר:')).toBeNull()
  })

  it('Facebook return with several pages opens the existing picker, not a silent Connect card', async () => {
    render(
      <IntegrationsLanding
        {...base()}
        initialSheet='facebook'
        oauthQuery={{ select: '1' }}
        facebook={{
          ...base().facebook,
          pendingPages: [
            { id: 'p1', name: 'דף א' },
            { id: 'p2', name: 'דף ב' },
          ],
        }}
      />,
    )

    expect(screen.queryByRole('button', { name: /^חבר פייסבוק$/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'השלימו חיבור' })).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'פייסבוק ואינסטגרם' })).toBeTruthy()
    expect(screen.getByText('בחר את הדף שברצונך לחבר:')).toBeTruthy()
    const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.some((c) => String(c[0]).includes('/api/auth/facebook/connect'))).toBe(false)
  })

  it('Facebook OAuth denied shows the approved Hebrew failure, not Connect-as-usual', async () => {
    render(
      <IntegrationsLanding
        {...base()}
        initialSheet='facebook'
        oauthQuery={{ error: 'denied' }}
      />,
    )
    expect(screen.getByText('החיבור לפייסבוק לא הושלם')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'פייסבוק ואינסטגרם' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^חבר פייסבוק$/ })).toBeNull()
  })

  it('WhatsApp return with one pending phone auto-completes without a second Connect tap', async () => {
    render(
      <IntegrationsLanding
        {...base()}
        initialSheet='whatsapp'
        whatsapp={{
          ...base().whatsapp,
          pendingPhones: [{ id: 'phone-1', displayPhone: '+97250', verifiedName: 'עסק' }],
        }}
      />,
    )
    expect(screen.queryByRole('button', { name: /^חבר וואטסאפ$/ })).toBeNull()
    await waitFor(() => {
      const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      expect(calls.some((c) => String(c[0]).includes('/api/auth/whatsapp/connect'))).toBe(true)
    })
  })

  it('Google Calendar cancel opens the calendar sheet with an explicit retry', async () => {
    render(
      <IntegrationsLanding
        {...base()}
        initialSheet='calendar'
        oauthQuery={{ gcal_error: 'denied' }}
      />,
    )
    expect(screen.getByRole('dialog', { name: 'Google Calendar' })).toBeTruthy()
    expect(screen.getByText('החיבור לא הושלם')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'לנסות שוב' })).toBeTruthy()
  })
})

describe('desktop protection — source contracts', () => {
  it('the integrations page still mounts LeadSourcesSection on desktop', () => {
    const src = readFileSync(
      join(process.cwd(), 'app/(app)/settings/(user_settings)/integrations/page.tsx'),
      'utf8',
    )
    expect(src).toContain('isMobileWorkspaceRequest')
    expect(src).toContain('IntegrationsMobile')
    expect(src).toContain('LeadSourcesSection')
    expect(src).toContain('ConnectedToolsSection')
  })

  it('does not add a page-reload OAuth workaround', () => {
    const landing = readFileSync(join(process.cwd(), 'modules/settings/mobile/IntegrationsLanding.tsx'), 'utf8')
    const hook = readFileSync(join(process.cwd(), 'modules/settings/mobile/useIntegrationReturn.ts'), 'utf8')
    expect(landing).not.toContain('window.location.reload')
    expect(hook).not.toContain('window.location.reload')
    expect(hook).toContain('/api/auth/facebook/connect')
    expect(hook).toContain('/api/auth/whatsapp/connect')
  })

  it('does not teach desktop FacebookConnect to auto-POST', () => {
    const src = readFileSync(join(process.cwd(), 'components/settings/FacebookConnect.tsx'), 'utf8')
    expect(src).not.toContain('shouldAutoCompleteFacebook')
    expect(src).toContain("window.location.href = '/api/auth/facebook'")
    expect(src).toContain('disabled={!selectedPageId || loading}')
  })

  it('LeadSourcesSection is still the UrlSyncedAccordion', () => {
    const src = readFileSync(
      join(process.cwd(), 'components/settings/integrations/LeadSourcesSection.tsx'),
      'utf8',
    )
    expect(src).toContain('UrlSyncedAccordion')
    expect(src).toContain("id='whatsapp'")
    expect(src).toContain("id='facebook'")
    expect(src).toContain("id='templates'")
  })

  it('TemplatesSection and SendReadyMessage stay the desktop surfaces', () => {
    const templates = readFileSync(
      join(process.cwd(), 'components/settings/templates/TemplatesSection.tsx'),
      'utf8',
    )
    const send = readFileSync(join(process.cwd(), 'components/clients/SendReadyMessage.tsx'), 'utf8')
    expect(templates).toContain('TemplatesWorkspace')
    expect(send).toContain("pos='middle'")
    expect(send).not.toContain('SendReadyMessageMobile')
    expect(send).not.toContain('BottomSheet')
  })
})
