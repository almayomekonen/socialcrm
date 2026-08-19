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
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ connected: false }),
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

  it('opens the existing WhatsApp connect UI in a sheet', async () => {
    render(<IntegrationsLanding {...base()} />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'חבר וואטסאפ' }))
    expect(screen.getByRole('dialog', { name: 'וואטסאפ' })).toBeTruthy()
    expect(screen.getByText(/חבר את מספר הוואטסאפ העסקי/)).toBeTruthy()
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
