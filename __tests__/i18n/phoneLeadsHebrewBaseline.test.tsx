// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import { DETAIL, EXPIRED, LIST_ROWS, NOW, SOURCE_DETAILS, resetPhoneEnv, phoneEnv } from './phoneLeadsEnv'
import { phoneDetailPage, phoneLeadsPage, phoneShell, setPhone } from './phoneLeadsHarness'

/**
 * HEBREW BASELINE, part 1 (i18n Phase F2): server HTML of the phone lead
 * screens — the REAL `/leads` page with the device gate answering "phone"
 * (populated with every card shape, more to load, search / status filtered
 * empty, the first import banner, the empty workspace's first run for each
 * connection state) and the REAL `/clients/[id]/summary` page on a phone
 * (populated, no phone, the first-lead guidance, every provenance source, not
 * found, expired), plus a JSON snapshot of the label producers. Recorded
 * BEFORE Phase F2 on unmodified code; Hebrew must match byte-for-byte.
 * Interactions: phoneLeadsHebrewBaselineInteractions / …Detail.
 *
 * No i18n provider. Normalized: React's `<!-- -->` text separators and `useId` values only.
 */

vi.mock('next/navigation', async () => (await import('./phoneLeadsMocks')).navigationModule())
vi.mock('next/server', async () => (await import('./phoneLeadsMocks')).serverModule())
vi.mock('@/lib/analytics/track', () => ({ track: async () => {} }))
vi.mock('@/db/auth', async () => (await import('./phoneLeadsMocks')).authModule())
vi.mock('@/lib/requireUser', async () => {
  const { PHONE_USER } = await import('./phoneLeadsEnv')
  return { requireAgencyUser: async () => PHONE_USER, requireBasicCrmAccess: async () => PHONE_USER }
})
vi.mock('@/db/uiLocale', async () => (await import('./phoneLeadsMocks')).uiLocaleModule())
vi.mock('@/lib/device', async () => (await import('./phoneLeadsMocks')).deviceModule())
vi.mock('@/lib/flags/mobileFlags', () => ({ canEnterMobileWorkspace: () => true }))
vi.mock('@/modules/leads/queries', async () => (await import('./phoneLeadsMocks')).queriesModule())
vi.mock('@/db/whatsapp', async () => (await import('./phoneLeadsMocks')).whatsappDbModule())
vi.mock('@/db/facebook', async () => (await import('./phoneLeadsMocks')).facebookDbModule())
vi.mock('@/modules/inbox/queries', async () => (await import('./phoneLeadsMocks')).inboxQueriesModule())
vi.mock('@/db/inboxMessages', async () => (await import('./phoneLeadsMocks')).inboxMessagesModule())
vi.mock('@/db/leadFormAnswers', async () => (await import('./phoneLeadsMocks')).formAnswersModule())
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess: async () => ({ hasAccess: true }) }))
vi.mock('@/actions/ai/leadIntelligence', async () => (await import('./phoneLeadsMocks')).intelligenceModule())
vi.mock('@/actions/ai/leadIntelligenceRefresh', () => ({ refreshLeadIntelligence: async () => ({ ok: true }) }))
vi.mock('@/actions/clients', async () => (await import('./phoneLeadsMocks')).clientsActionsModule())
vi.mock('@/actions/leads/loadMoreMobileLeads', async () => (await import('./phoneLeadsMocks')).loadMoreModule())
vi.mock('@/actions/leadFollowUp', async () => (await import('./phoneLeadsMocks')).followUpModule())
vi.mock('@/actions/leadOutcome', async () => (await import('./phoneLeadsMocks')).outcomeModule())
vi.mock('@/actions/leadDuplicates', async () => (await import('./phoneLeadsMocks')).duplicatesModule())
vi.mock('@/modules/inbox/actions', async () => (await import('./phoneLeadsMocks')).inboxActionsModule())
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: async () => {} }))
vi.mock('@/actions/analytics/recordFirstLeadEvent', () => ({ recordFirstLeadEvent: async () => {} }))
vi.mock('@/components/education/AutoTour', () => ({ default: () => null }))
vi.mock('@/lib/toast', async () => (await import('./phoneLeadsMocks')).toastModule())

function normalizeIds(html: string) {
  return html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}
const renderToString = (node: ReactNode) => normalizeIds(renderRaw(<>{node}</>).replaceAll('<!-- -->', ''))
const list = async (params: Record<string, string> = {}) => renderToString(await phoneShell(null, await phoneLeadsPage(params)))
const detail = async (params: Record<string, string> = {}, ent?: typeof EXPIRED) =>
  renderToString(await phoneShell(null, await phoneDetailPage(params), ent))

beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetPhoneEnv()
})

describe('Hebrew baseline — the phone lead list (/leads on a phone)', () => {
  test('populated (every card shape), more to load, the first import banner', async () => {
    const out: Record<string, string> = {}
    out.populated = await list()
    setPhone({ hasMore: true })
    out.hasMore = await list()
    out.firstImport = await list({ firstImport: '6', firstLeadId: '11', firstImportSkipped: '2' })
    setPhone({ waConnected: false })
    out.whatsappNotConnected = await list()
    expect(out.hasMore).toContain('טען עוד')
    expect(out).toMatchSnapshot()
  })

  test('filtered empty (search, status), the empty workspace for each connection state', async () => {
    const out: Record<string, string> = {}
    setPhone({ rows: [] })
    out.searchEmpty = await list({ q: 'דנה' })
    out.statusEmpty = await list({ status: 'closed,lost' })
    out.searchAndStatus = await list({ q: '052', status: 'new' })
    setPhone({ workspaceHasLeads: false })
    out.firstRun = await list()
    setPhone({ meta: { connected: true, needsReconnect: false } })
    out.firstRunMeta = await list()
    setPhone({ waConnected: true, meta: { connected: true, needsReconnect: false } })
    out.firstRunBoth = await list()
    setPhone({ waConnected: false, meta: { connected: true, needsReconnect: true } })
    out.firstRunMetaReconnect = await list()
    expect(out.searchEmpty).toContain('לא נמצאו לידים')
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — the phone lead detail (/clients/[id]/summary on a phone)', () => {
  test('populated, no phone, no follow-up, first-lead guidance, not found, expired', async () => {
    const out: Record<string, string> = {}
    out.populated = await detail()
    out.firstLead = await detail({ firstLead: '1' })
    setPhone({ detail: { ...DETAIL, nextFollowUpAt: null, followUpNote: null, lastOutcomeType: null, lastActivityAt: null } })
    out.noFollowUp = await detail({ firstLead: '1' })
    setPhone({ detail: { ...DETAIL, phone: null, waPhone: null, secPhone: null, email: null, status: 'lost' } })
    out.noPhone = await detail()
    setPhone({ detail: { ...DETAIL, nextFollowUpAt: new Date(NOW + 3 * 3600_000).toISOString(), status: 'weird' } })
    out.dueTodayUnknownStatus = await detail()
    setPhone({ detail: DETAIL })
    out.expired = await detail({}, EXPIRED)
    setPhone({ detail: null })
    out.notFound = await detail()
    expect(out.populated).toContain('תוצאה אחרונה')
    expect(out).toMatchSnapshot()
  })

  test('the provenance card for every source', async () => {
    const out: Record<string, string> = {}
    for (const [name, source] of Object.entries(SOURCE_DETAILS)) {
      setPhone({ detail: { ...DETAIL, ...source }, formAnswers: name === 'facebook' ? [{ key: 'city', values: ['חיפה'] }] : [] })
      out[name] = await detail()
    }
    setPhone({ detail: { ...DETAIL, ...SOURCE_DETAILS.whatsapp }, waPreview: { conversationId: null as unknown as number, preview: null as unknown as string } })
    out.whatsappNoConversation = await detail()
    setPhone({ detail: { ...DETAIL, ...SOURCE_DETAILS.facebook, firstName: null, lastName: null, email: null } })
    out.facebookPhoneOnly = await detail()
    expect(out.facebook).toContain('Facebook')
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — label producers (as data)', () => {
  test('follow-up badge, provenance model, recency', async () => {
    const { followUpBadge } = await import('@/modules/leads/mobile/followUpBadge')
    const { buildMobileProvenanceModel } = await import('@/modules/leads/mobile/leadProvenanceModel')
    const { relativeTimeHe } = await import('@/modules/inbox/mobile/relativeTime')
    const { startOfBusinessDayMs } = await import('@/lib/today/time')
    const day = startOfBusinessDayMs(NOW)
    const H = 3600_000
    const badges = Object.fromEntries(
      Object.entries({ none: null, invalid: 'nope', overdue: NOW - 30 * H, earlierToday: day + H, laterToday: NOW + 2 * H, tomorrow: NOW + 30 * H }).map(([k, v]) => [
        k,
        followUpBadge(typeof v === 'number' ? new Date(v).toISOString() : v, NOW, day),
      ]),
    )
    const models = Object.fromEntries(
      Object.entries({ ...SOURCE_DETAILS, manual: {} }).map(([k, s]) => [
        k,
        buildMobileProvenanceModel({ ...DETAIL, ...s, conversationId: k === 'whatsapp' ? 9 : null, preview: k === 'whatsapp' ? 'היי' : null } as never),
      ]),
    )
    const recency = LIST_ROWS.map((r) => relativeTimeHe(r.lastActivityAt ?? r.createdAt, NOW))
    expect({ badges, models, recency, rows: phoneEnv.rows.length }).toMatchSnapshot()
  })
})
