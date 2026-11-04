// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { resolveAsync } from './dashboardHarness'
import { ACTIVE, ATTRIBUTION, EXPIRED, FAMILY, INTELLIGENCE, NEVER_STARTED, NOW, SUMMARY_LEAD, detailEnv, resetDetailEnv } from './leadDetailEnv'

/**
 * HEBREW BASELINE for the lead DETAIL screen: the `/clients/[clientId]` layout
 * (header + tab nav), its loading state, and `/clients/[clientId]/summary`.
 * Recorded against the code BEFORE the Phase C lead-detail package; every Hebrew
 * render and every label producer must still match byte-for-byte afterwards.
 *
 * The REAL server layout and page run here; only I/O (db, actions, flags) is
 * mocked. Out of scope and replaced by nothing: the Copilot lead context, the
 * education tour, the mobile lead detail.
 *
 * Normalized before comparing, and only these:
 *  · React's invisible `<!-- -->` text separators.
 *  · React `useId` values (tree shape, not text).
 */

const H = vi.hoisted(() => ({
  toasts: [] as unknown[][],
  proToasts: [] as unknown[],
  refreshReason: 'rate-limited' as string,
}))

vi.mock('next/navigation', async () => {
  const { detailEnv: env } = await import('./leadDetailEnv')
  return {
    useSearchParams: () => new URLSearchParams(env.search),
    useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
    usePathname: () => env.pathname,
    redirect: (to: string) => {
      throw new Error('REDIRECT ' + to)
    },
  }
})
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {}, cacheTag: () => {}, unstable_cache: (fn: unknown) => fn }))
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => null }), headers: () => ({ get: () => null }) }))
vi.mock('@/db/auth', async () => ({ getUser: async () => (await import('./leadDetailEnv')).DETAIL_USER }))
vi.mock('@/lib/requireUser', async () => ({ requireAgencyUser: async () => (await import('./leadDetailEnv')).DETAIL_USER }))
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: null, agencyLocale: null }) }))
vi.mock('@/lib/device', () => ({ isMobileRequest: async () => false, isMobileWorkspaceRequest: async () => false }))
vi.mock('@/db/clients', async () => {
  const { detailEnv: env } = await import('./leadDetailEnv')
  return {
    getFullLead: async () => (env.header || env.lead ? { ...(env.header ?? {}), ...(env.lead ?? {}) } : null),
    getFamMembers: async () => ({ famMembers: env.family, familyId: env.family.length ? 1 : null }),
  }
})
vi.mock('@/db/usersNTeams', async () => {
  const { detailEnv: env } = await import('./leadDetailEnv')
  return { getUserNameById: async () => env.handlerName, getUsers: async () => [] }
})
vi.mock('@/db/filter', () => ({ getPerms: async () => ({ gotPermIds: [], gotPermUsers: [], allPermUsers: [] }) }))
vi.mock('@/db/leadNotes', () => ({ getLeadNotes: async () => [] }))
vi.mock('@/db/tasks', async () => {
  const { detailEnv: env } = await import('./leadDetailEnv')
  return { get5TasksByClientId: async () => env.tasks }
})
vi.mock('@/modules/inbox/queries', async () => {
  const { detailEnv: env } = await import('./leadDetailEnv')
  return { getInboxConversationByLeadId: async () => (env.conversationId ? { conversationId: env.conversationId } : null) }
})
vi.mock('@/db/inboxMessages', async () => {
  const { detailEnv: env } = await import('./leadDetailEnv')
  return { listConversationMessages: async () => env.messages }
})
vi.mock('@/db/leadFormAnswers', async () => {
  const { detailEnv: env } = await import('./leadDetailEnv')
  return { formAnswersForLead: async () => env.formAnswers }
})
vi.mock('@/db/adsCrmOutcomes', async () => {
  const { detailEnv: env } = await import('./leadDetailEnv')
  return { getLeadAdAttribution: async () => env.attribution }
})
vi.mock('@/db/adsSnapshots', async () => {
  const { detailEnv: env } = await import('./leadDetailEnv')
  return { readCreativeForAd: async () => env.creative }
})
vi.mock('@/lib/facebook/permissions', async () => {
  const { detailEnv: env } = await import('./leadDetailEnv')
  return { isFacebookAdsReportingEnabledForAgency: () => env.adsReporting }
})
vi.mock('@/lib/whatsapp/templates/flag', async () => {
  const { detailEnv: env } = await import('./leadDetailEnv')
  return { isTemplatesEnabledForAgency: () => env.templatesEnabled }
})
vi.mock('@/db/whatsappTemplates', async () => {
  const { detailEnv: env } = await import('./leadDetailEnv')
  return { listTemplates: async () => env.templates }
})
vi.mock('@/lib/inbox/whatsappOutboundTarget', async () => {
  const { detailEnv: env } = await import('./leadDetailEnv')
  return { resolveWhatsappOutboundTarget: async () => (env.reachable ? { ok: true } : { ok: false, reason: 'not_connected' }) }
})
vi.mock('@/lib/access/productAccess', async () => {
  const { detailEnv: env } = await import('./leadDetailEnv')
  return { getAgencyProductAccess: async () => ({ hasAccess: env.hasAccess }) }
})
vi.mock('@/actions/ai/leadIntelligence', async () => {
  const { detailEnv: env } = await import('./leadDetailEnv')
  return { getLeadIntelligence: async () => env.intelligence }
})
vi.mock('@/actions/ai/leadIntelligenceRefresh', () => ({ refreshLeadIntelligence: async () => ({ ok: false, reason: H.refreshReason }) }))
vi.mock('@/actions/leadFollowUp', () => ({ setLeadFollowUp: async () => ({}), clearLeadFollowUp: async () => ({}) }))
vi.mock('@/actions/leadOutcome', () => ({ logLeadOutcome: async () => ({}) }))
vi.mock('@/actions/whatsapp/templates/sendTemplateToLead', () => ({ sendTemplateToLead: async () => ({ ok: true }) }))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: async () => {} }))
vi.mock('@/actions/analytics/recordFirstLeadEvent', () => ({ recordFirstLeadEvent: async () => {} }))
vi.mock('@/lib/toast', () => ({
  toast: (...args: unknown[]) => H.toasts.push(args),
  proToast: (opts: unknown) => H.proToasts.push(opts),
}))
// Out of this package's scope: Copilot lead context, the education tour, the mobile detail.
vi.mock('@/components/copilot/CopilotLeadContext', () => ({ default: () => null }))
vi.mock('@/components/education/AutoTour', () => ({ default: () => null }))
vi.mock('@/modules/leads/mobile/LeadDetailMobile', () => ({ default: () => null }))
vi.mock('@/modules/leads/queries', () => ({ getMobileLeadDetail: async () => null }))
vi.mock('@/components/sales/saleForm/SaleForm', () => ({ default: () => null }))

const { default: Layout } = await import('@/app/(he)/(app)/clients/[clientId]/layout')
const { default: SummaryPage } = await import('@/app/(he)/(app)/clients/[clientId]/summary/page')
const { EntitlementProvider } = await import('@/lib/entitlement/EntitlementContext')
const { __resetFirstLeadFlowForTests } = await import('@/components/clients/firstLeadFlow')

function normalizeIds(html: string) {
  return html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}

function renderToString(node: ReactNode) {
  return normalizeIds(renderRaw(<>{node}</>).replaceAll('<!-- -->', ''))
}

function html(el: Element | null) {
  if (!el) throw new Error('element not found')
  return normalizeIds(el.outerHTML)
}

type Ent = typeof ACTIVE | typeof EXPIRED | typeof NEVER_STARTED

function withEnt(ent: Ent, node: ReactNode) {
  return <EntitlementProvider value={ent}>{node}</EntitlementProvider>
}

async function layoutHtml(ent: Ent = ACTIVE) {
  const tree = await resolveAsync(await Layout({ children: <div id='tab-content'>CHILD</div>, params: Promise.resolve({ clientId: '41' }) }))
  return renderToString(withEnt(ent, tree))
}

async function summaryTree() {
  return resolveAsync(await SummaryPage({ params: Promise.resolve({ clientId: '41' }), searchParams: Promise.resolve({}) }))
}

async function summaryHtml(ent: Ent = ACTIVE) {
  return renderToString(withEnt(ent, await summaryTree()))
}

/** One region of a server render, by selector. */
function region(markup: string, selector: string): string {
  const host = document.createElement('div')
  host.innerHTML = markup
  const el = host.querySelector(selector)
  return el ? normalizeIds(el.outerHTML) : 'ABSENT'
}

const set = (overrides: Partial<typeof detailEnv>) => Object.assign(detailEnv, overrides)
const FB_LEAD = { ...SUMMARY_LEAD, leadSource: 'facebook:1234567890', firstName: 'ליד מפייסבוק', lastName: '' }

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => {
  vi.useRealTimers()
})
afterEach(() => {
  cleanup()
  resetDetailEnv()
  __resetFirstLeadFlowForTests()
  H.toasts.length = 0
  H.proToasts.length = 0
})

describe('Hebrew baseline — /clients/[clientId] layout (header + nav)', () => {
  test('lead with phone, email, handler, birth date and gender', async () => {
    expect(await layoutHtml()).toMatchSnapshot()
  })

  test('customer (closed lead) with family members, no phone, no email, no handler', async () => {
    set({ header: { ...detailEnv.header, phone: null, email: null, gender: 'נקבה', birthDate: null }, lead: { ...SUMMARY_LEAD, status: 'closed', phone: null, email: null }, family: FAMILY, handlerName: null })
    expect(await layoutHtml()).toMatchSnapshot()
  })

  test('lead not found', async () => {
    set({ header: null, lead: null })
    expect(await layoutHtml()).toMatchSnapshot()
  })

  test('ClientNav: the active tab follows the path', async () => {
    const { default: ClientNav } = await import('@/components/clientPage/ClientNav')
    const out: Record<string, string> = {}
    for (const tab of ['summary', 'tasks', 'files', 'billing']) {
      set({ pathname: `/clients/41/${tab}` })
      out[tab] = renderToString(<ClientNav id='41' />)
    }
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — loading.tsx', () => {
  test('desktop spinner and phone skeleton', async () => {
    const { default: Loading } = await import('@/app/(he)/(app)/clients/[clientId]/loading')
    const { MobileWorkspaceContext } = await import('@/components/mobile/MobileWorkspaceContext')
    expect({
      desktop: renderToString(<Loading />),
      phone: renderToString(
        <MobileWorkspaceContext.Provider value>
          <Loading />
        </MobileWorkspaceContext.Provider>,
      ),
    }).toMatchSnapshot()
  })
})

describe('Hebrew baseline — /clients/[clientId]/summary (server HTML)', () => {
  test('manual lead: follow-up set with note, last outcome, ready messages, intelligence', async () => {
    expect(await summaryHtml()).toMatchSnapshot()
  })

  test('first-lead callout: shown (no follow-up yet), done (follow-up set), hidden', async () => {
    const out: Record<string, string> = {}
    set({ search: 'firstLead=1', lead: { ...SUMMARY_LEAD, nextFollowUpAt: null, followUpNote: null, lastOutcomeType: null, lastActivityAt: null } })
    out.shownNoFollowUp = await summaryHtml()
    __resetFirstLeadFlowForTests()
    set({ search: 'firstLead=1', lead: SUMMARY_LEAD })
    out.done = region(await summaryHtml(), '[role="status"]')
    __resetFirstLeadFlowForTests()
    set({ search: '' })
    out.hidden = region(await summaryHtml(), '[role="status"]')
    expect(out).toMatchSnapshot()
  })

  test('inbound context: Meta form answers (Facebook, Instagram), WhatsApp with and without a conversation', async () => {
    const out: Record<string, string> = {}
    set({ lead: FB_LEAD })
    out.facebookPlaceholderName = region(await summaryHtml(), 'section')
    set({ lead: { ...FB_LEAD, leadSource: 'instagram:55', firstName: 'יוסי' } })
    out.instagramWithName = region(await summaryHtml(), 'section')
    set({ lead: { ...FB_LEAD, phone: '', email: '', createdAt: null }, formAnswers: [] })
    out.facebookNothingCaptured = region(await summaryHtml(), 'section')
    set({ lead: { ...SUMMARY_LEAD, leadSource: 'whatsapp:972501234567' } })
    out.whatsappWithConversation = region(await summaryHtml(), 'section')
    set({ lead: { ...SUMMARY_LEAD, leadSource: 'whatsapp:972501234567' }, conversationId: null })
    out.whatsappNoConversation = region(await summaryHtml(), 'section')
    set({ lead: SUMMARY_LEAD })
    out.manualNone = region(await summaryHtml(), 'section')
    expect(out).toMatchSnapshot()
  })

  test('ad attribution: paid (report link), paid without link, organic, absent', async () => {
    const pick = async () => {
      const host = document.createElement('div')
      host.innerHTML = await summaryHtml()
      const p = Array.from(host.querySelectorAll('p')).find((e) => /הגיע מ/.test(e.textContent ?? ''))
      return p ? normalizeIds(p.parentElement!.parentElement!.outerHTML) : 'ABSENT'
    }
    const out: Record<string, string> = {}
    set({ attribution: ATTRIBUTION, creative: { payload: { imageUrl: 'https://cdn.example.test/ad.jpg' } } })
    out.paidWithReport = await pick()
    set({ attribution: { ...ATTRIBUTION, platform: 'fb' }, creative: null, adsReporting: false })
    out.paidNoReport = await pick()
    set({ attribution: { ...ATTRIBUTION, campaignName: null, adsetName: null, adName: null, platform: null, isOrganic: true } })
    out.organic = await pick()
    set({ attribution: null })
    out.absent = await pick()
    expect(out).toMatchSnapshot()
  })

  test('status badge for every status, and follow-up line: unset, overdue', async () => {
    const out: Record<string, string> = {}
    for (const status of ['new', 'contacted', 'interested', 'closed', 'lost', 'weird', null]) {
      set({ lead: { ...SUMMARY_LEAD, status } })
      const host = document.createElement('div')
      host.innerHTML = await summaryHtml()
      const badge = host.querySelector('[data-edu="lead-status"]')
      out[`status:${status}`] = badge ? normalizeIds(badge.parentElement!.parentElement!.outerHTML) : 'NO BADGE'
    }
    set({ lead: { ...SUMMARY_LEAD, nextFollowUpAt: null, followUpNote: null, lastOutcomeType: null } })
    out.unset = region(await summaryHtml(), '.rounded-lg.border.border-gray-200.bg-white.p-5.mb-8')
    set({ lead: { ...SUMMARY_LEAD, nextFollowUpAt: new Date(NOW - 3 * 86_400_000).toISOString(), lastOutcomeType: 'meeting_no_show' } })
    out.overdue = region(await summaryHtml(), '.rounded-lg.border.border-gray-200.bg-white.p-5.mb-8')
    expect(out).toMatchSnapshot()
  })

  test('ready messages: available, no approved template, not WhatsApp-reachable, flag off', async () => {
    const has = (markup: string) => markup.includes('שלח הודעה מוכנה')
    const out: Record<string, unknown> = {}
    out.available = region(await summaryHtml(), '.mb-8.flex.justify-end')
    set({ templates: [] })
    out.noTemplate = has(await summaryHtml())
    set({ templates: detailEnv.templates, reachable: false })
    out.notReachable = has(await summaryHtml())
    set({ reachable: true, templatesEnabled: false })
    out.flagOff = has(await summaryHtml())
    expect(out).toMatchSnapshot()
  })

  test('expired subscription: follow-up locked with and without a date, teaser card', async () => {
    const out: Record<string, string> = {}
    set({ hasAccess: false })
    out.withDate = await summaryHtml(EXPIRED)
    set({ lead: { ...SUMMARY_LEAD, nextFollowUpAt: null } })
    out.withoutDate = region(await summaryHtml(NEVER_STARTED), '.rounded-lg.border.border-gray-200.bg-white.p-5.mb-8')
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — lead intelligence card', () => {
  async function card(ent: Ent = ACTIVE) {
    const { default: LeadIntelligenceCard } = await import('@/components/ai/LeadIntelligenceCard')
    return renderToString(withEnt(ent, await resolveAsync(await LeadIntelligenceCard({ leadId: 41 }))))
  }

  test('populated (every confidence), empty insights/sources, error, teaser, backstop, disabled, cached-but-expired', async () => {
    const out: Record<string, string> = {}
    for (const confidence of ['high', 'medium', 'low'] as const) {
      set({ intelligence: { ok: true, data: { ...INTELLIGENCE, confidence } } })
      out[`populated:${confidence}`] = await card()
    }
    set({ intelligence: { ok: true, data: { ...INTELLIGENCE, keyInsights: [], sources: [] } } })
    out.emptyLists = await card()
    set({ intelligence: { ok: false, reason: 'provider-error' } })
    out.error = await card()
    set({ intelligence: { ok: false, reason: 'subscription-required' } })
    out.backstopTeaser = await card()
    set({ intelligence: { ok: false, reason: 'disabled' } })
    out.disabled = await card()
    set({ hasAccess: false })
    out.teaser = await card(EXPIRED)
    set({ hasAccess: true, intelligence: { ok: true, data: INTELLIGENCE } })
    out.cachedButExpired = await card(EXPIRED)
    const { default: Skeleton } = await import('@/components/ai/LeadIntelligenceCardSkeleton')
    out.skeleton = renderToString(<Skeleton />)
    expect(out).toMatchSnapshot()
  })

  test('refresh feedback: rate limited, failed', async () => {
    const { default: RefreshLeadIntelligenceButton } = await import('@/components/ai/RefreshLeadIntelligenceButton')
    const out: Record<string, string> = {}
    for (const reason of ['rate-limited', 'failed']) {
      H.refreshReason = reason
      const { container, unmount } = render(<RefreshLeadIntelligenceButton leadId={41} />)
      await act(async () => {
        fireEvent.click(container.querySelector('button')!)
      })
      out[reason] = html(container.firstElementChild)
      unmount()
    }
    expect(out).toMatchSnapshot()
  })

  test('teaser Pro toast', async () => {
    const { default: Teaser } = await import('@/components/ai/LeadIntelligenceTeaser')
    render(<Teaser />)
    fireEvent.click(screen.getByRole('button'))
    expect(H.proToasts).toMatchSnapshot()
  })
})

describe('Hebrew baseline — interactive: follow-up menu, ready message dialog, callout', () => {
  test('follow-up menu (set and unset), toasts after set and clear', async () => {
    const { default: FollowUpControl } = await import('@/components/leads/FollowUpControl')
    const out: Record<string, unknown> = {}
    for (const current of [SUMMARY_LEAD.nextFollowUpAt, null]) {
      const { container, unmount } = render(<FollowUpControl leadId={41} current={current} />)
      fireEvent.click(container.querySelector('button')!)
      out[`menu:${current ? 'set' : 'unset'}`] = html(document.querySelector('[role="menu"]'))
      if (current) {
        await act(async () => {
          fireEvent.click(screen.getAllByRole('menuitem')[0])
        })
        fireEvent.click(container.querySelector('button')!)
        await act(async () => {
          fireEvent.click(screen.getAllByRole('menuitem').at(-1)!)
        })
      }
      out[`button:${current ? 'set' : 'unset'}`] = html(container.firstElementChild)
      unmount()
    }
    out.compact = renderToString(<FollowUpControl leadId={41} current={SUMMARY_LEAD.nextFollowUpAt} compact />)
    out.compactExpired = renderToString(withEnt(EXPIRED, <FollowUpControl leadId={41} current={SUMMARY_LEAD.nextFollowUpAt} compact />))
    out.compactExpiredNone = renderToString(withEnt(EXPIRED, <FollowUpControl leadId={41} current={null} compact />))
    out.toasts = H.toasts
    expect(out).toMatchSnapshot()
  })

  test('ready message dialog: open, preview, sending, sent toast, expired Pro toast', async () => {
    const { default: SendReadyMessage } = await import('@/components/clients/SendReadyMessage')
    const out: Record<string, unknown> = {}
    const { unmount } = render(<SendReadyMessage leadId={41} templates={detailEnv.templates as never} />)
    fireEvent.click(screen.getByRole('button'))
    out.open = html(document.querySelector('[role="dialog"]'))
    fireEvent.click(document.querySelector('input[type="radio"]')!)
    out.selected = html(document.querySelector('[role="dialog"]'))
    await act(async () => {
      fireEvent.click(Array.from(document.querySelectorAll('[role="dialog"] button')).at(-1)!)
    })
    unmount()
    const expired = render(withEnt(EXPIRED, <SendReadyMessage leadId={41} templates={detailEnv.templates as never} />))
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(document.querySelector('input[type="radio"]')!)
    await act(async () => {
      fireEvent.click(Array.from(document.querySelectorAll('[role="dialog"] button')).at(-1)!)
    })
    expired.unmount()
    out.toasts = H.toasts
    out.proToasts = H.proToasts
    expect(out).toMatchSnapshot()
  })

  test('header email copy toast', async () => {
    const writeText = vi.fn()
    Object.assign(navigator, { clipboard: { writeText } })
    const { default: ClientHeader } = await import('@/components/clientPage/ClientHeader')
    render(<ClientHeader client={{ name: 'יוסי לוי', email: 'yossi@example.test' }} user={null} handlerName={null} family={[]} clientId='41' formProps={null} />)
    fireEvent.click(screen.getByText('yossi@example.test'))
    expect({ toasts: H.toasts, copied: writeText.mock.calls }).toMatchSnapshot()
  })
})

describe('Hebrew baseline — SubscriptionExpiredState', () => {
  test('every mode, with and without a feature line, lapsed and never started', async () => {
    const { default: SubscriptionExpiredState } = await import('@/components/entitlement/SubscriptionExpiredState')
    const out: Record<string, string> = {}
    for (const [k, ent] of [['expired', EXPIRED], ['neverStarted', NEVER_STARTED]] as const) {
      for (const mode of ['page', 'panel', 'inline'] as const) {
        out[`${k}:${mode}`] = renderToString(withEnt(ent, <SubscriptionExpiredState mode={mode} source='lead_followup' />))
        out[`${k}:${mode}:feature`] = renderToString(withEnt(ent, <SubscriptionExpiredState mode={mode} source='lead_followup' feature='חידוש המנוי מחזיר את קביעת המעקבים' />))
      }
    }
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — label producers (default arguments)', () => {
  test('outcome labels, inbound copy and captured labels, capture time, form answer labels, dates', async () => {
    const { OUTCOME_LABELS, outcomeLabel } = await import('@/lib/leads/outcomeRules')
    const { INBOUND_LEAD_COPY, CAPTURED_FIELD_LABELS } = await import('@/lib/leads/inboundLeadCopy')
    const data = await import('@/lib/leads/inboundLeadContextData')
    const { formAnswerLabel, displayableFormAnswers } = await import('@/lib/facebook/leadFormAnswers')
    const { formatDate, formatDateAge } = await import('@/lib/dates')
    const { STATUS_STYLES } = await import('@/lib/leads/statusStyles')
    const keys = ['city', 'state', 'country', 'province', 'street_address', 'post_code', 'zip_code', 'company_name', 'job_title', 'work_email', 'work_phone_number', 'date_of_birth', 'gender', 'marital_status', 'relationship_status', 'CITY', 'מה_התקציב_שלך?', 'when_do_you_want_to_start?']
    expect({
      outcomes: { OUTCOME_LABELS, lookups: ['call_no_answer', 'meeting_no_show', 'unknown_code', null].map((c) => outcomeLabel(c)) },
      inbound: { INBOUND_LEAD_COPY, CAPTURED_FIELD_LABELS, FB_NAME_PLACEHOLDER: data.FB_NAME_PLACEHOLDER },
      captured: [
        data.facebookCapturedFieldLabels(true, true, true),
        data.facebookCapturedFieldLabels(false, true, false),
        data.facebookCapturedFieldLabels(),
      ],
      presence: data.facebookFieldPresence({ firstName: 'ליד מפייסבוק', lastName: '', phone: '050', email: null }),
      captureAt: [data.formatCaptureAt('2026-08-16T13:59:00.000Z'), data.formatCaptureAt(null), data.formatCaptureAt('bad')],
      formAnswerLabels: keys.map((k) => formAnswerLabel(k)),
      displayable: displayableFormAnswers([{ key: 'full_name', values: ['x'] }, { key: 'Phone_Number', values: [] }, { key: 'city', values: ['חיפה'] }]),
      statusLabels: Object.fromEntries(Object.entries(STATUS_STYLES).map(([k, v]) => [k, v.label])),
      dates: [formatDate(SUMMARY_LEAD.nextFollowUpAt), formatDateAge(new Date('1990-05-01T00:00:00Z'))],
    }).toMatchSnapshot()
  })
})
