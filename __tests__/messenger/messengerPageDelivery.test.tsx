// @vitest-environment jsdom
/**
 * The Messenger tab's empty state is a promise that messages will arrive.
 *
 * Incident 2026-09-14: Messenger rolled out, `pages_messaging` recorded, tab said
 * "אין עדיין הודעות" — and the Page was not subscribed to Messenger events, so
 * nothing could ever arrive. The page now keeps that state only when Meta's
 * subscription for the Page allows it, and otherwise shows the one admin action
 * that fixes it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const h = vi.hoisted(() => ({
  user: { id: 332, agencyId: 103, role: 'ADMIN' } as Record<string, unknown>,
  pages: [] as { page_id: string; granted_scopes: unknown; health_checked_at?: unknown }[],
  delivery: new Map<string, string>(),
  checked: [] as { pageId: string; rowCheckedAt: unknown }[],
  conversations: [] as unknown[],
  after: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/inbox/messenger',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/server', () => ({ after: h.after }))
vi.mock('@/components/summary/ConversationRefreshPoller', () => ({
  default: ({ intervalMs }: { intervalMs: number }) => <span data-testid='refresh-poller' data-interval={intervalMs} />,
}))
vi.mock('@/db/auth', () => ({ getUser: async () => h.user }))
vi.mock('@/config/db', () => {
  const qb = { where: () => qb, select: async () => h.pages }
  return { db: () => qb }
})
vi.mock('@/lib/device', () => ({
  getInAppBrowser: async () => null,
  isMobileWorkspaceRequest: async () => false,
}))
vi.mock('@/modules/messenger/queries', () => ({
  listMessengerConversations: async () => h.conversations,
  getMessengerConversation: async () => null,
  listMessengerMessages: async () => [],
}))
vi.mock('@/modules/messenger/actions', () => ({
  sendMessengerReply: vi.fn(),
  markMessengerConversationRead: vi.fn(),
}))
vi.mock('@/modules/messenger/leadActions', () => ({
  createLeadFromMessengerConversation: vi.fn(),
  linkMessengerConversationToLead: vi.fn(),
}))
vi.mock('@/actions/clients', () => ({ searchLeads: vi.fn(async () => []) }))
// The real button navigates with window.location; a link exposes the same href to assert on.
vi.mock('@/components/settings/MetaPermissionButton', () => ({
  default: ({ href, lbl }: { href: string; lbl: string }) => <a href={href}>{lbl}</a>,
}))
vi.mock('@/lib/facebook/messenger/deliveryCheck', () => ({
  checkMessengerDelivery: async (pageId: string, opts: { rowCheckedAt?: unknown }) => {
    h.checked.push({ pageId, rowCheckedAt: opts?.rowCheckedAt })
    return h.delivery.get(pageId) ?? 'ready'
  },
  pendingMessengerDeliveryChecks: async () => {},
}))

import MessengerPage from '@/app/(app)/inbox/messenger/page'

const GRANTED = JSON.stringify(['pages_show_list', 'pages_manage_metadata', 'pages_messaging'])
const RECONNECT_CTA = 'חבר מחדש את הדף ל-Messenger'

async function renderPage(searchParams: Record<string, string> = {}) {
  render(await MessengerPage({ searchParams: Promise.resolve(searchParams) }))
}

beforeEach(() => {
  vi.stubEnv('FACEBOOK_MESSENGER_ENABLED', '1')
  vi.stubEnv('FACEBOOK_MESSENGER_AGENCY_ALLOWLIST', '103')
  h.user = { id: 332, agencyId: 103, role: 'ADMIN' }
  h.pages = [{ page_id: 'PG1', granted_scopes: GRANTED }]
  h.delivery = new Map()
  h.checked = []
  h.conversations = []
  h.after.mockClear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe('Messenger tab — no conversations', () => {
  it('does not promise messages when the Page is not subscribed to Messenger events', async () => {
    h.delivery.set('PG1', 'not_subscribed')
    await renderPage()
    expect(screen.queryByText('אין עדיין הודעות')).not.toBeInTheDocument()
    expect(screen.getByText('הודעות Messenger עדיין לא מגיעות לכאן')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: RECONNECT_CTA })).toHaveAttribute('href', '/api/auth/facebook?feature=messenger')
  })

  it('does not show the "permission approved" confirmation over a Page that still cannot receive', async () => {
    h.delivery.set('PG1', 'not_subscribed')
    await renderPage({ permission: 'granted' })
    expect(screen.queryByText(/ההרשאה אושרה\. הודעות Messenger חדשות יופיעו כאן/)).not.toBeInTheDocument()
  })

  it('a refused Page token gets the expired-connection notice, not a Messenger-only one', async () => {
    h.delivery.set('PG1', 'reconnect')
    await renderPage()
    expect(screen.getByText('החיבור לפייסבוק פג')).toBeInTheDocument()
    expect(screen.queryByText('הודעות Messenger עדיין לא מגיעות לכאן')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'לחבר מחדש' })).toHaveAttribute('href', '/api/auth/facebook?feature=messenger')
  })

  it('one Page that cannot receive is enough to withhold the promise', async () => {
    h.pages = [
      { page_id: 'PG1', granted_scopes: GRANTED },
      { page_id: 'PG2', granted_scopes: GRANTED },
    ]
    h.delivery.set('PG2', 'not_subscribed')
    await renderPage()
    expect(screen.queryByText('אין עדיין הודעות')).not.toBeInTheDocument()
    expect(screen.getByText('הודעות Messenger עדיין לא מגיעות לכאן')).toBeInTheDocument()
  })

  it("passes each Page row's last write so a reconnect is never answered from a stale cache", async () => {
    const reconnectedAt = new Date('2026-09-15T00:10:00Z')
    h.pages = [{ page_id: 'PG1', granted_scopes: GRANTED, health_checked_at: reconnectedAt }]
    await renderPage({ permission: 'granted' })
    expect(h.checked).toEqual([{ pageId: 'PG1', rowCheckedAt: reconnectedAt }])
  })

  it('shows "no messages yet" when Meta is delivering the Page', async () => {
    await renderPage()
    expect(screen.getByText('אין עדיין הודעות')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: RECONNECT_CTA })).not.toBeInTheDocument()
  })

  it('a check that could not reach Meta is not turned into an alarm', async () => {
    h.delivery.set('PG1', 'unknown')
    await renderPage()
    expect(screen.getByText('אין עדיין הודעות')).toBeInTheDocument()
  })

  it('checks only Pages that have the messaging grant', async () => {
    h.pages = [
      { page_id: 'PG1', granted_scopes: GRANTED },
      { page_id: 'PG_LEADS_ONLY', granted_scopes: JSON.stringify(['pages_show_list', 'leads_retrieval']) },
    ]
    await renderPage()
    expect(h.checked.map((c) => c.pageId)).toEqual(['PG1'])
  })

  it('does not ask Meta once conversations exist — messages are demonstrably arriving', async () => {
    h.conversations = [
      {
        id: 1,
        pageId: 'PG1',
        psid: 'P1',
        displayName: 'Tester',
        lastMessageText: 'hi',
        lastMessageAt: new Date('2026-09-15T00:00:00Z'),
        lastInboundAt: new Date('2026-09-15T00:00:00Z'),
        unread: true,
        leadId: null,
      },
    ]
    await renderPage()
    expect(h.checked).toEqual([])
  })

  it('a non-admin sees who can fix it instead of a button that ends on "forbidden"', async () => {
    h.user = { id: 400, agencyId: 103, role: 'AGNT' }
    h.delivery.set('PG1', 'not_subscribed')
    await renderPage()
    expect(screen.getByText('הודעות Messenger עדיין לא מגיעות לכאן')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: RECONNECT_CTA })).not.toBeInTheDocument()
  })
})

describe('Messenger tab — the empty state keeps itself current', () => {
  it.each(['ready', 'unknown', 'not_subscribed', 'reconnect'])(
    '%s: refreshes, so the first message appears and a fixed Page clears the prompt without a reload',
    async (verdict) => {
      h.delivery.set('PG1', verdict)
      await renderPage()
      expect(screen.getAllByTestId('refresh-poller')).toHaveLength(1)
      expect(screen.getByTestId('refresh-poller')).toHaveAttribute('data-interval', '10000')
    },
  )

  it('hands checks still running to after(), so a slow Meta answer still fills the cache', async () => {
    await renderPage()
    expect(h.after).toHaveBeenCalledTimes(1)
  })
})

describe('Messenger tab — outside the rollout', () => {
  it('never checks Meta for an agency Messenger is not rolled out to', async () => {
    vi.stubEnv('FACEBOOK_MESSENGER_AGENCY_ALLOWLIST', '999')
    await renderPage()
    expect(h.checked).toEqual([])
  })
})
