// @vitest-environment jsdom
//
// Mobile /leads: batch loading, and the offset bug it replaced.
//
// WHAT WAS BROKEN. The phone list used `?page=` page SWITCHING: reaching lead 31
// replaced leads 1-30 and lost the scroll position. Worse, the batch query asked
// `getLeadsTable` for `PAGE_SIZE + 1` rows as a "has more" probe — but that
// function derives `offset = (pageNum - 1) * tableLimit`, so the probe also
// widened the STRIDE. Batch 2 started at offset 31 while batch 1 had shown 30,
// and exactly one lead was skipped at every boundary, unreachable from the phone.
//
// Now: batches accumulate behind "טען עוד", and the stride is the true page size
// with a separate LIMIT 1 look-ahead.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const loadMore = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/leads',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
vi.mock('@/actions/clients', () => ({ deleteManyLeads: vi.fn(async () => ({})) }))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: vi.fn(async () => {}) }))
vi.mock('@/modules/inbox/client/openLeadWhatsapp', () => ({
  openLeadWhatsappInInbox: vi.fn(async () => {}),
  WHATSAPP_CONNECT_HREF: '/settings/integrations?section=whatsapp',
}))
vi.mock('@/lib/entitlement/EntitlementContext', () => ({
  useAccessDenied: () => false,
  useEntitlement: () => ({ status: 'ACTIVE', hasAccess: true, expiresAt: null }),
}))
vi.mock('@/actions/leads/loadMoreMobileLeads', () => ({
  loadMoreMobileLeads: (...a: unknown[]) => loadMore(...a),
}))

import LeadListMobileClient from '@/modules/leads/mobile/LeadListMobileClient'

const NOW = Date.UTC(2026, 7, 22, 9, 0, 0)
const card = (id: number) => ({
  id,
  name: `ליד ${id}`,
  phone: '0541234567',
  waPhone: '972541234567',
  email: null,
  status: 'new' as const,
  sourceLabel: 'ידני',
  sourceChannel: 'manual' as const,
  nextFollowUpAt: null,
  lastActivityAt: null,
  createdAt: null,
  nextAction: null,
  severity: null,
  isNewBadge: false,
  handlerName: null,
  recency: 'עכשיו',
  followUp: null,
})

const filters = { q: '', status: [] as never[] }

const renderList = (over: Record<string, unknown> = {}) =>
  render(
    <LeadListMobileClient
      cards={[card(1), card(2)] as never}
      filters={filters as never}
      hasMore
      page={1}
      nowMs={NOW}
      dayStartMs={NOW}
      {...over}
    />,
  )

beforeEach(() => {
  loadMore.mockReset().mockResolvedValue({ rows: [], hasMore: false, page: 2 })
})
afterEach(() => cleanup())

describe('mobile leads batch loading', () => {
  it('LM-1: the first batch renders', () => {
    renderList()
    expect(screen.getByText('ליד 1')).toBeTruthy()
    expect(screen.getByText('ליד 2')).toBeTruthy()
  })

  it('LM-2: "טען עוד" requests the NEXT batch, with the current filters', async () => {
    const active = { q: 'דנה', status: ['new'] }
    renderList({ filters: active })

    fireEvent.click(screen.getByRole('button', { name: 'טען עוד' }))

    await waitFor(() => expect(loadMore).toHaveBeenCalledWith(active, 2))
  })

  it('LM-3: previously loaded leads stay rendered — no page switching', async () => {
    loadMore.mockResolvedValue({ rows: [{ ...card(3), recency: undefined, followUp: undefined }], hasMore: false, page: 2 })
    renderList()

    fireEvent.click(screen.getByRole('button', { name: 'טען עוד' }))

    await waitFor(() => expect(screen.getByText('ליד 3')).toBeTruthy())
    expect(screen.getByText('ליד 1')).toBeTruthy()
    expect(screen.getByText('ליד 2')).toBeTruthy()
  })

  it('LM-4: a second tap while loading does not fire a duplicate request', async () => {
    let release: (v: unknown) => void = () => {}
    loadMore.mockImplementation(() => new Promise((r) => (release = r)))
    renderList()

    const btn = screen.getByRole('button', { name: 'טען עוד' })
    fireEvent.click(btn)
    fireEvent.click(btn)
    fireEvent.click(btn)

    await waitFor(() => expect(loadMore).toHaveBeenCalledTimes(1))
    release({ rows: [], hasMore: false, page: 2 })
  })

  it('LM-5: a loading state is shown while the batch is in flight', async () => {
    loadMore.mockImplementation(() => new Promise(() => {}))
    renderList()

    fireEvent.click(screen.getByRole('button', { name: 'טען עוד' }))

    await waitFor(() => expect(screen.getByRole('button', { name: /טוען/ })).toBeTruthy())
    expect(screen.getByRole('button', { name: /טוען/ }).getAttribute('aria-busy')).toBe('true')
  })

  it('LM-6: the button disappears when there are no more results', async () => {
    loadMore.mockResolvedValue({ rows: [], hasMore: false, page: 2 })
    renderList()

    fireEvent.click(screen.getByRole('button', { name: 'טען עוד' }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'טען עוד' })).toBeNull())
  })

  it('LM-7: no button at all when the first batch is already the whole list', () => {
    renderList({ hasMore: false })
    expect(screen.queryByRole('button', { name: 'טען עוד' })).toBeNull()
  })

  it('LM-8: NO page-switching UI remains — no prev/next links, no "עמוד N" label', () => {
    renderList()
    expect(screen.queryByText(/עמוד/)).toBeNull()
    expect(screen.queryByRole('link', { name: 'הבא' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'הקודם' })).toBeNull()
  })
})

describe('filter changes invalidate accumulated batch state', () => {
  it('LM-13: a new search resets the cursor — the next batch is 2, not N+1', async () => {
    loadMore.mockResolvedValue({ rows: [], hasMore: true, page: 2 })
    const { rerender } = renderList()

    // Accumulate: we are now on batch 2.
    fireEvent.click(screen.getByRole('button', { name: 'טען עוד' }))
    await waitFor(() => expect(loadMore).toHaveBeenCalledWith(filters, 2))

    // The user searches; the server re-renders batch 1 of a NEW result set.
    const next = { q: 'דנה', status: [] as never[] }
    rerender(
      <LeadListMobileClient
        cards={[card(9)] as never}
        filters={next as never}
        hasMore
        page={1}
        nowMs={NOW}
        dayStartMs={NOW}
      />,
    )

    loadMore.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'טען עוד' }))

    // Must ask for batch 2 of the new set — asking for 3 would skip its batch 2.
    await waitFor(() => expect(loadMore).toHaveBeenCalledWith(next, 2))
  })

  it('LM-14: an in-flight batch from the OLD filters is discarded, not appended', async () => {
    let release: (v: unknown) => void = () => {}
    loadMore.mockImplementation(() => new Promise((r) => (release = r)))
    const { rerender } = renderList()

    fireEvent.click(screen.getByRole('button', { name: 'טען עוד' }))
    await waitFor(() => expect(loadMore).toHaveBeenCalled())

    // Filters change while the request is still in flight.
    rerender(
      <LeadListMobileClient
        cards={[card(9)] as never}
        filters={{ q: 'דנה', status: [] } as never}
        hasMore={false}
        page={1}
        nowMs={NOW}
        dayStartMs={NOW}
      />,
    )
    // The stale response now arrives carrying rows from the PREVIOUS result set.
    release({ rows: [{ ...card(3) }], hasMore: false, page: 2 })

    await waitFor(() => expect(screen.getByText('ליד 9')).toBeTruthy())
    expect(screen.queryByText('ליד 3')).toBeNull()
  })

  it('LM-15: a failed batch leaves the button usable, never permanently disabled', async () => {
    loadMore.mockRejectedValue(new Error('network'))
    renderList()

    fireEvent.click(screen.getByRole('button', { name: 'טען עוד' }))

    await waitFor(() => expect(loadMore).toHaveBeenCalledTimes(1))
    const btn = await screen.findByRole('button', { name: 'טען עוד' })
    expect(btn.hasAttribute('disabled')).toBe(false)

    // …and a retry is actually possible.
    loadMore.mockResolvedValue({ rows: [], hasMore: false, page: 2 })
    fireEvent.click(btn)
    await waitFor(() => expect(loadMore).toHaveBeenCalledTimes(2))
  })
})

describe('the query stride is correct (the skipped-lead bug)', () => {
  const src = readFileSync(join(process.cwd(), 'modules/leads/queries.ts'), 'utf8')

  it('LM-9: rows are fetched with the true page size, not the +1 probe', () => {
    // `offset = (pageNum - 1) * tableLimit`, so passing PAGE_SIZE + 1 as the
    // limit also widened the stride and skipped a row per batch.
    expect(src).toContain('tableLimit: MOBILE_LEAD_PAGE_SIZE }')
    expect(src).not.toContain('tableLimit: MOBILE_LEAD_PAGE_SIZE + 1')
  })

  it('LM-10: hasMore comes from a separate LIMIT 1 look-ahead', () => {
    expect(src).toContain('tableLimit: 1')
    expect(src).toContain('hasMore: lookahead.length > 0')
  })
})

describe('load-more is Tier 1 — reading leads stays free', () => {
  const action = readFileSync(join(process.cwd(), 'actions/leads/loadMoreMobileLeads.ts'), 'utf8')

  it('LM-11: guarded with requireBasicCrmAccess, never requireProductAccess', () => {
    // Assert the CALL, not the prose — the docstring names the guard it avoids.
    expect(action).toContain('await requireBasicCrmAccess()')
    expect(action).not.toContain('await requireProductAccess(')
  })

  it('LM-12: it reuses the existing query rather than adding a second mechanism', () => {
    expect(action).toContain('getMobileLeadList')
  })
})
