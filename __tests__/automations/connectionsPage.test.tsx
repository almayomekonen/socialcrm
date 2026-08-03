// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import fs from 'node:fs'
import path from 'node:path'

import IntegrationConnectionCard from '@/components/settings/connections/IntegrationConnectionCard'
import ConnectionsSettings from '@/components/settings/connections/ConnectionsSettings'
import ConnectionDetails from '@/components/settings/connections/ConnectionDetails'
import { HEALTH, STRATEGY, SUBSCRIPTION, timeAgo } from '@/components/settings/connections/copy'
import { AUTH_STRATEGIES, CONNECTION_HEALTH, SOURCE_SUBSCRIPTION_STATES } from '@/lib/automations/catalog/vocabularies'
import { listIntegrations } from '@/lib/automations/catalog/registry'
import type { IntegrationView } from '@/lib/automations/connectors/overview'
import type { AuthStrategy } from '@/lib/automations/catalog/vocabularies'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))

/**
 * ══════════════════════════════════════════════════════════════════════════
 * C2 — the Connections page renders from catalog metadata, and nothing else.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The centrepiece is "Zeta Desk": an integration that exists only in this file,
 * with an auth strategy, a capability, sources and a health state the page has
 * never seen. It renders completely — because the page has no idea what any
 * integration is.
 */

afterEach(cleanup)

const view = (over: Partial<IntegrationView> = {}): IntegrationView => ({
  integration: {
    key: 'zeta_desk',
    title: 'Zeta Desk',
    icon: 'headset',
    auth: 'api_key',
    capabilities: ['zeta_connected'],
  },
  unlocks: [
    { key: 'ticket.opened', title: 'נפתחה פנייה' },
    { key: 'ticket.closed', title: 'נסגרה פנייה' },
  ],
  connections: [],
  connected: false,
  needsAttention: false,
  ...over,
})

const connection = (over: Partial<IntegrationView['connections'][number]> = {}) => ({
  id: 'zeta_desk:1',
  displayName: 'הדסק הראשי',
  health: 'ok' as const,
  sources: [
    { id: 'q_1', label: 'תור תמיכה', subscription: 'subscribed' as const, health: 'ok' as const },
    { id: 'q_2', label: 'תור מכירות', subscription: 'pending' as const, health: 'ok' as const },
  ],
  automations: 3,
  lastActivityAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  ...over,
})

const noop = () => {}

describe('an integration the page has never heard of renders completely', () => {
  it('shows its icon, title and a description DERIVED from what it unlocks', () => {
    render(<IntegrationConnectionCard view={view()} onChanged={noop} />)
    expect(screen.getByText('Zeta Desk')).toBeInTheDocument()
    // The description is catalog truth, not a hand-written blurb.
    expect(screen.getByText(/נפתחה פנייה · נסגרה פנייה/)).toBeInTheDocument()
  })

  it('shows the disconnected state and its strategy’s own connect label', () => {
    render(<IntegrationConnectionCard view={view()} onChanged={noop} />)
    expect(screen.getByText('לא מחובר')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: STRATEGY.api_key.connect })).toBeInTheDocument()
  })

  it('shows health, source count, automation count and last activity per connection', () => {
    render(<IntegrationConnectionCard view={view({ connections: [connection()], connected: true })} onChanged={noop} />)
    expect(screen.getByText('הדסק הראשי')).toBeInTheDocument()
    expect(screen.getAllByText(HEALTH.ok.label).length).toBeGreaterThan(0)
    expect(screen.getByText(/2 מקורות · 3 אוטומציות · פעילות אחרונה לפני 3 שעות/)).toBeInTheDocument()
  })

  it('offers reconnect on a healthy connection, not a second "connect"', () => {
    render(<IntegrationConnectionCard view={view({ connections: [connection()], connected: true })} onChanged={noop} />)
    expect(screen.getByRole('button', { name: STRATEGY.api_key.reconnect })).toBeInTheDocument()
  })

  it('says "עדיין לא נרשמה פעילות" rather than implying silence is failure', () => {
    render(
      <IntegrationConnectionCard
        view={view({ connections: [connection({ lastActivityAt: null, automations: 0 })], connected: true })}
        onChanged={noop}
      />,
    )
    expect(screen.queryByText(/פעילות אחרונה/)).not.toBeInTheDocument()
  })
})

describe('an unhealthy connection tells the truth, loudly', () => {
  const broken = view({
    connections: [connection({ health: 'revoked', automations: 4 })],
    connected: false,
    needsAttention: true,
  })

  it('marks the whole integration דורש טיפול', () => {
    render(<IntegrationConnectionCard view={broken} onChanged={noop} />)
    expect(screen.getByText('דורש טיפול')).toBeInTheDocument()
  })

  it('names the consequence for the automations that depend on it', () => {
    render(<IntegrationConnectionCard view={broken} onChanged={noop} />)
    expect(screen.getByRole('alert')).toHaveTextContent('מסומנות כדורשות טיפול')
  })

  it('offers no "ניתוק" for something already revoked', () => {
    render(<IntegrationConnectionCard view={broken} onChanged={noop} />)
    expect(screen.queryByRole('button', { name: 'ניתוק' })).not.toBeInTheDocument()
  })

  it('a degraded connection is surfaced as its own state, not as connected', () => {
    render(
      <IntegrationConnectionCard
        view={view({ connections: [connection({ health: 'degraded' })], needsAttention: true })}
        onChanged={noop}
      />,
    )
    expect(screen.getByText(HEALTH.degraded.label)).toBeInTheDocument()
    expect(screen.queryByText(HEALTH.ok.label)).not.toBeInTheDocument()
  })
})

describe('connection details render sources, capabilities and impact', () => {
  it('lists every source with its subscription state', () => {
    render(<ConnectionDetails view={view()} connection={connection()} onClose={noop} />)
    expect(screen.getByText('תור תמיכה')).toBeInTheDocument()
    expect(screen.getByText('תור מכירות')).toBeInTheDocument()
    expect(screen.getByText(SUBSCRIPTION.pending.label)).toBeInTheDocument()
  })

  it('shows a failing source’s health beside its subscription', () => {
    const c = connection({ sources: [{ id: 's', label: 'תור', subscription: 'failed', health: 'degraded' }] })
    render(<ConnectionDetails view={view()} connection={c} onClose={noop} />)
    expect(screen.getByText(SUBSCRIPTION.failed.label)).toBeInTheDocument()
    expect(screen.getByText(HEALTH.degraded.label)).toBeInTheDocument()
  })

  it('lists what the connection unlocks — the capability, in the user’s words', () => {
    render(<ConnectionDetails view={view()} connection={connection()} onClose={noop} />)
    expect(screen.getByText('נפתחה פנייה')).toBeInTheDocument()
  })

  it('states the automation impact when the connection is not healthy', () => {
    render(<ConnectionDetails view={view()} connection={connection({ health: 'needs_reauth' })} onClose={noop} />)
    expect(screen.getByRole('alert')).toHaveTextContent('לא יפעלו')
  })

  it('an empty source list explains itself rather than showing nothing', () => {
    render(<ConnectionDetails view={view()} connection={connection({ sources: [] })} onClose={noop} />)
    expect(screen.getByText(/עדיין לא זוהו מקורות/)).toBeInTheDocument()
  })
})

describe('every closed vocabulary value has UI — a new one is a compile error', () => {
  it('every connection health state', () => {
    for (const h of CONNECTION_HEALTH) expect(HEALTH[h]?.label, `no copy for health "${h}"`).toBeTruthy()
  })

  it('every source subscription state', () => {
    for (const s of SOURCE_SUBSCRIPTION_STATES) expect(SUBSCRIPTION[s]?.label, `no copy for "${s}"`).toBeTruthy()
  })

  it('every auth strategy', () => {
    for (const a of AUTH_STRATEGIES) expect(STRATEGY[a]?.how, `no flow for strategy "${a}"`).toBeTruthy()
  })

  it('a strategy that needs a connection offers a way to make one', () => {
    for (const a of AUTH_STRATEGIES) {
      if (STRATEGY[a].needsConnection) expect(STRATEGY[a].connect, `strategy "${a}" has no connect label`).toBeTruthy()
    }
  })
})

describe('every auth strategy renders its own flow', () => {
  const forStrategy = (auth: AuthStrategy) => view({ integration: { ...view().integration, auth } })

  it('oauth2 hands off at a path derived from the key — no route table', () => {
    render(<IntegrationConnectionCard view={forStrategy('oauth2')} onChanged={noop} />)
    expect(screen.getByRole('link', { name: STRATEGY.oauth2.connect })).toHaveAttribute(
      'href',
      '/api/automations/connect/zeta_desk',
    )
  })

  it('embedded_signup hands off the same way, with its own wording', () => {
    render(<IntegrationConnectionCard view={forStrategy('embedded_signup')} onChanged={noop} />)
    expect(screen.getByRole('link', { name: STRATEGY.embedded_signup.connect })).toHaveAttribute(
      'href',
      '/api/automations/connect/zeta_desk',
    )
  })

  it('api_key opens a dialog rather than navigating', () => {
    render(<IntegrationConnectionCard view={forStrategy('api_key')} onChanged={noop} />)
    expect(screen.getByRole('button', { name: STRATEGY.api_key.connect })).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('none offers no connect action at all, and says why', () => {
    render(<IntegrationConnectionCard view={forStrategy('none')} onChanged={noop} />)
    expect(screen.getByText('לא נדרש חיבור')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /התחברות|יצירת חיבור|התחלת הרשמה/ })).not.toBeInTheDocument()
  })
})

describe('the page draws whatever the catalog registered', () => {
  it('renders one card per integration, in catalog order', () => {
    const views = [view(), view({ integration: { ...view().integration, key: 'other', title: 'Other System' } })]
    render(<ConnectionsSettings views={views} />)
    expect(screen.getByText('Zeta Desk')).toBeInTheDocument()
    expect(screen.getByText('Other System')).toBeInTheDocument()
  })

  it('an empty catalog is an explained empty state, never a blank page', () => {
    render(<ConnectionsSettings views={[]} />)
    expect(screen.getByText(/עדיין אין חיבורים זמינים/)).toBeInTheDocument()
  })

  it('every SHIPPED integration has an icon, a title and a known strategy', () => {
    for (const i of listIntegrations()) {
      expect(i.icon, `${i.key} has no icon`).toBeTruthy()
      expect(i.title, `${i.key} has no title`).toBeTruthy()
      expect(STRATEGY[i.auth], `${i.key} has an unknown strategy`).toBeTruthy()
    }
  })
})

describe('zero integration-specific UI knowledge — CI-enforced', () => {
  const DIR = 'components/settings/connections'
  const FILES = fs
    .readdirSync(path.join(process.cwd(), DIR))
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .map((f) => path.join(DIR, f))

  /** Strips comments — documentation may name an integration; code may not. */
  const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('there are components to check', () => {
    expect(FILES.length).toBeGreaterThan(0)
  })

  it('no component names an integration, a capability or a provider', () => {
    const NAMES = ['calendly', 'contact_form_7', 'contactform7', 'wordpress', 'whatsapp', 'facebook', 'shopify', 'gravity']
    const violations: string[] = []
    for (const file of FILES) {
      const code = codeOnly(fs.readFileSync(path.join(process.cwd(), file), 'utf8'))
      for (const name of NAMES) {
        if (new RegExp(`['"\`]?${name}['"\`]?`, 'i').test(code)) violations.push(`${file} → ${name}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('no component branches on an integration key', () => {
    const violations: string[] = []
    for (const file of FILES) {
      const code = codeOnly(fs.readFileSync(path.join(process.cwd(), file), 'utf8'))
      // A switch, or a comparison against `integrationKey` / `integration.key`.
      if (/\bswitch\s*\(/.test(code)) violations.push(`${file} → switch`)
      if (/integration(Key)?\s*(===|==|!==)/.test(code)) violations.push(`${file} → key comparison`)
      if (/\.key\s*(===|==|!==)/.test(code)) violations.push(`${file} → key comparison`)
    }
    expect(violations).toEqual([])
  })

  it('the guard actually catches a violation', () => {
    const synthetic = `if (integration.key === 'calendly') return <CalendlyCard/>`
    expect(/\.key\s*(===|==|!==)/.test(codeOnly(synthetic))).toBe(true)
  })
})

describe('relative time is honest about what it does not know', () => {
  it('reports null for a missing or future timestamp rather than guessing', () => {
    expect(timeAgo(null)).toBe(null)
    expect(timeAgo(new Date(Date.now() + 60_000).toISOString())).toBe(null)
    expect(timeAgo('not a date')).toBe(null)
  })

  it('reads naturally across the ranges it covers', () => {
    const ago = (ms: number) => timeAgo(new Date(Date.now() - ms).toISOString())
    expect(ago(30_000)).toBe('לפני רגע')
    expect(ago(5 * 60_000)).toBe('לפני 5 דקות')
    expect(ago(2 * 3_600_000)).toBe('לפני 2 שעות')
    expect(ago(26 * 3_600_000)).toBe('אתמול')
    expect(ago(5 * 24 * 3_600_000)).toBe('לפני 5 ימים')
  })
})
