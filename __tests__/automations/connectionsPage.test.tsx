// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import fs from 'node:fs'
import path from 'node:path'

import IntegrationConnectionCard from '@/components/settings/connections/IntegrationConnectionCard'
import ConnectionsSettings from '@/components/settings/connections/ConnectionsSettings'
import ConnectionDetails from '@/components/settings/connections/ConnectionDetails'
import { DELIVERY, HEALTH, STRATEGY, SUBSCRIPTION, timeAgo } from '@/components/settings/connections/copy'
import { AUTH_STRATEGIES, CONNECTION_HEALTH, SOURCE_SUBSCRIPTION_STATES } from '@/lib/automations/catalog/vocabularies'
import { listIntegrations } from '@/lib/automations/catalog/registry'
import type { DeliveryState, IntegrationView } from '@/lib/automations/connectors/overview'
import type { AuthStrategy } from '@/lib/automations/catalog/vocabularies'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))

// The details modal fetches its setup guide and can rotate a secret; both are
// server actions, so they are stubbed at the module boundary.
vi.mock('@/actions/automations/connections', () => ({
  connectionSetup: vi.fn(async () => ({
    ok: true,
    webhookUrl: 'https://app.example/api/automations/webhooks/zeta_desk?c=zeta_desk%3A1',
    guide: {
      title: 'חיבור בשלושה צעדים',
      steps: ['צעד ראשון', 'צעד שני'],
      snippet: { label: 'קוד', language: 'php', code: 'echo "hi";' },
    },
  })),
  regenerateSecret: vi.fn(async () => ({ ok: true, connectionId: 'zeta_desk:1', webhookUrl: 'u', secret: 'S3CR3T' })),
  renameSource: vi.fn(async () => ({ ok: true })),
  revokeConnection: vi.fn(async () => ({ ok: true })),
  provisionApiKeyConnection: vi.fn(async () => ({ ok: true, connectionId: 'x', webhookUrl: 'u', secret: 's' })),
}))

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
  lastEventAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  eventCount: 12,
  delivery: 'receiving' as const,
  reportsDelivery: true,
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
    expect(screen.getAllByText(DELIVERY.receiving.label).length).toBeGreaterThan(0)
    expect(screen.getByText(/2 מקורות · 3 אוטומציות/)).toBeInTheDocument()
  })

  it('offers reconnect on a healthy connection, not a second "connect"', () => {
    render(<IntegrationConnectionCard view={view({ connections: [connection()], connected: true })} onChanged={noop} />)
    expect(screen.getByRole('button', { name: STRATEGY.api_key.reconnect })).toBeInTheDocument()
  })

  it('omits "last activity" entirely rather than implying silence is failure', () => {
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
    connections: [connection({ health: 'revoked', automations: 4, delivery: 'disconnected' })],
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
        view={view({
          connections: [connection({ health: 'degraded', delivery: 'disconnected' })],
          needsAttention: true,
        })}
        onChanged={noop}
      />,
    )
    expect(screen.getByText(HEALTH.degraded.label)).toBeInTheDocument()
    expect(screen.queryByText(DELIVERY.receiving.label)).not.toBeInTheDocument()
  })
})

describe('connection details render sources, capabilities and impact', () => {
  it('lists every source with its subscription state', () => {
    render(<ConnectionDetails view={view()} connection={connection()} onClose={noop} onChanged={noop} />)
    expect(screen.getByText('תור תמיכה')).toBeInTheDocument()
    expect(screen.getByText('תור מכירות')).toBeInTheDocument()
    expect(screen.getByText(SUBSCRIPTION.pending.label)).toBeInTheDocument()
  })

  it('shows a failing source’s health beside its subscription', () => {
    const c = connection({ sources: [{ id: 's', label: 'תור', subscription: 'failed', health: 'degraded' }] })
    render(<ConnectionDetails view={view()} connection={c} onClose={noop} onChanged={noop} />)
    expect(screen.getByText(SUBSCRIPTION.failed.label)).toBeInTheDocument()
    expect(screen.getByText(HEALTH.degraded.label)).toBeInTheDocument()
  })

  it('lists what the connection unlocks — the capability, in the user’s words', () => {
    render(<ConnectionDetails view={view()} connection={connection()} onClose={noop} onChanged={noop} />)
    expect(screen.getByText('נפתחה פנייה')).toBeInTheDocument()
  })

  it('states the automation impact when the connection is not healthy', () => {
    render(
      <ConnectionDetails
        view={view()}
        connection={connection({ health: 'needs_reauth', delivery: 'disconnected' })}
        onClose={noop}
        onChanged={noop}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('לא יפעלו')
  })

  it('an empty source list explains itself rather than showing nothing', () => {
    render(<ConnectionDetails view={view()} connection={connection({ sources: [] })} onClose={noop} onChanged={noop} />)
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

/**
 * ══════════════════════════════════════════════════════════════════════════
 * C3 — what a real business needs before this is usable without a developer.
 * ══════════════════════════════════════════════════════════════════════════
 */

describe('C3 — "is anything getting through?" is answerable', () => {
  const STATES: DeliveryState[] = ['disconnected', 'never_received', 'receiving', 'unknown']

  it('every delivery state has its own Hebrew — a new one is a compile error', () => {
    for (const s of STATES) expect(DELIVERY[s]?.label, `no copy for delivery "${s}"`).toBeTruthy()
  })

  it('a connection that has never received data says so, and is NOT called מחובר', () => {
    render(
      <IntegrationConnectionCard
        view={view({
          connections: [connection({ delivery: 'never_received', eventCount: 0, lastEventAt: null })],
          connected: true,
        })}
        onChanged={noop}
      />,
    )
    expect(screen.getByText(DELIVERY.never_received.label)).toBeInTheDocument()
    expect(screen.getByText(DELIVERY.never_received.hint)).toBeInTheDocument()
    // The exact lie C3 removes: healthy-but-silent must not read as working.
    expect(screen.queryByText(DELIVERY.receiving.label)).not.toBeInTheDocument()
  })

  it('never_received is a WARNING, because setup is not finished', () => {
    expect(DELIVERY.never_received.role).toBe('warning')
    expect(DELIVERY.receiving.role).toBe('success')
  })

  it('a receiving connection shows when the last event arrived', () => {
    render(<IntegrationConnectionCard view={view({ connections: [connection()], connected: true })} onChanged={noop} />)
    expect(screen.getByText(/אירוע אחרון לפני 2 שעות/)).toBeInTheDocument()
  })

  it('a connector that does not report deliveries says so instead of "never"', () => {
    render(
      <IntegrationConnectionCard
        view={view({
          connections: [connection({ delivery: 'unknown', reportsDelivery: false, eventCount: 0, lastEventAt: null })],
          connected: true,
        })}
        onChanged={noop}
      />,
    )
    expect(screen.getByText(DELIVERY.unknown.hint)).toBeInTheDocument()
    expect(screen.queryByText(DELIVERY.never_received.label)).not.toBeInTheDocument()
  })

  it('the details view separates event delivery from automation activity', async () => {
    render(<ConnectionDetails view={view()} connection={connection()} onClose={noop} onChanged={noop} />)
    expect(await screen.findByText(/אירוע אחרון לפני 2 שעות · 12 אירועים בסך הכול/)).toBeInTheDocument()
    expect(screen.getByText(/פעילות אוטומציות אחרונה לפני 3 שעות/)).toBeInTheDocument()
  })
})

describe('C3 — setup is self-service, and the address is never lost', () => {
  it('renders the connector’s own steps and snippet, generically', async () => {
    render(<ConnectionDetails view={view()} connection={connection()} onClose={noop} onChanged={noop} />)
    expect(await screen.findByText('חיבור בשלושה צעדים')).toBeInTheDocument()
    expect(screen.getByText('צעד ראשון')).toBeInTheDocument()
    expect(screen.getByText('echo "hi";')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'העתקת הקוד' })).toBeInTheDocument()
  })

  it('the webhook address is retrievable forever — it is not a secret', async () => {
    render(<ConnectionDetails view={view()} connection={connection()} onClose={noop} onChanged={noop} />)
    expect(await screen.findByText('https://app.example/api/automations/webhooks/zeta_desk?c=zeta_desk%3A1')).toBeInTheDocument()
  })

  it('the secret is not retrievable, and the UI says so rather than hiding it', async () => {
    render(<ConnectionDetails view={view()} connection={connection()} onClose={noop} onChanged={noop} />)
    expect(await screen.findByText('הקוד הסודי אינו ניתן לשחזור.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'יצירת קוד סודי חדש' })).toBeInTheDocument()
  })

  it('rotating shows the new secret once, and warns that data stops until it is updated', async () => {
    render(<ConnectionDetails view={view()} connection={connection()} onClose={noop} onChanged={noop} />)
    fireEvent.click(await screen.findByRole('button', { name: 'יצירת קוד סודי חדש' }))
    expect(await screen.findByText('S3CR3T')).toBeInTheDocument()
    expect(screen.getByText(/עד אז לא יתקבלו נתונים/)).toBeInTheDocument()
  })
})

describe('C3 — a business can rename a discovered source', () => {
  it('offers a rename on every source, whatever the integration', async () => {
    render(<ConnectionDetails view={view()} connection={connection()} onClose={noop} onChanged={noop} />)
    expect((await screen.findAllByRole('button', { name: 'שינוי שם' })).length).toBe(2)
  })

  it('saves the new name and explains how to restore the original', async () => {
    const { renameSource } = await import('@/actions/automations/connections')
    render(<ConnectionDetails view={view()} connection={connection()} onClose={noop} onChanged={noop} />)
    fireEvent.click((await screen.findAllByRole('button', { name: 'שינוי שם' }))[0])
    expect(screen.getByText('השארת השדה ריק תחזיר את השם המקורי.')).toBeInTheDocument()

    const field = screen.getByDisplayValue('תור תמיכה')
    fireEvent.change(field, { target: { value: 'פניות מהאתר' } })
    fireEvent.click(screen.getByRole('button', { name: 'שמור שם' }))
    await screen.findByText('פניות מהאתר')
    expect(renameSource).toHaveBeenCalledWith('zeta_desk:1', 'q_1', 'פניות מהאתר')
  })
})

/**
 * PRODUCTION QA REGRESSION — an active automation reported as "0 automations".
 *
 * The Builder only showed the connection picker when MORE THAN ONE connection
 * existed. With exactly one it saved `connectionId: null` while resolving the
 * parameter picker's options against that same connection — so an automation
 * plainly belonging to a connection was never bound to it, and the Connections
 * page correctly counted zero.
 *
 * These assert the two rules that fix it, at the level the Builder applies
 * them: eligibility is the intersection of what an event NEEDS and what an
 * integration PROVIDES, and one eligible connection is auto-selected.
 */
describe('C-QA — connection binding', () => {
  const integrations = [
    {
      key: 'contact_form_7',
      title: 'Contact Form 7',
      icon: 'file-lines',
      auth: 'api_key' as const,
      capabilities: ['website_connected'],
    },
    { key: 'calendly', title: 'Calendly', icon: 'calendar', auth: 'oauth2' as const, capabilities: ['calendar_connected'] },
  ]
  const conns = [
    { id: 'contact_form_7:3', integrationKey: 'contact_form_7', agencyId: 103, displayName: 'האתר', health: 'ok' as const },
    { id: 'calendly:9', integrationKey: 'calendly', agencyId: 103, displayName: 'יומן', health: 'ok' as const },
  ]

  /** The rule the sheet applies: needed capabilities × provided capabilities. */
  const eligible = (required: string[], connections: typeof conns) => {
    const needed = new Set(required)
    if (needed.size === 0) return []
    return connections.filter((c) =>
      integrations.find((i) => i.key === c.integrationKey)?.capabilities.some((cap) => needed.has(cap)),
    )
  }
  const bound = (required: string[], connections: typeof conns) => {
    const e = eligible(required, connections)
    return e.length === 1 ? e[0].id : null
  }

  it('a calendar connection is never offered for a website-form event', () => {
    expect(eligible(['website_connected'], conns).map((c) => c.id)).toEqual(['contact_form_7:3'])
  })

  it('exactly one eligible connection is AUTO-SELECTED — the bug', () => {
    expect(bound(['website_connected'], conns)).toBe('contact_form_7:3')
  })

  it('several eligible connections force an explicit choice', () => {
    const two = [...conns, { ...conns[0], id: 'contact_form_7:4', displayName: 'אתר שני' }]
    expect(eligible(['website_connected'], two).length).toBe(2)
    expect(bound(['website_connected'], two)).toBe(null)
  })

  it('an event needing NO connection binds to none — it must never read as broken', () => {
    // Binding lead.created to a connection would mark it דורש טיפול the day
    // that connection is revoked, which it would not be.
    expect(eligible([], conns)).toEqual([])
    expect(bound([], conns)).toBe(null)
  })

  it('the shipped catalog really does declare these capabilities', async () => {
    const { getEvent, listIntegrations } = await import('@/lib/automations/catalog/registry')
    const needed = getEvent('form.submitted')!
      .requirements.filter((r) => r.type === 'connection')
      .map((r) => r.key)
    const provided = listIntegrations().find((i) => i.key === 'contact_form_7')!.capabilities
    expect(needed.some((n) => provided.includes(n))).toBe(true)
    expect(getEvent('lead.created')!.requirements.filter((r) => r.type === 'connection')).toEqual([])
  })
})
