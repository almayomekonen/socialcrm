// @vitest-environment jsdom
//
// The expired-subscription experience, as a contract.
//
// The forensic audit found one fact — the plan no longer covers the product —
// expressed six different ways: a silent no-op, a raw React #441 dialog,
// "משהו השתבש, נסה שוב", a permanent "בעיית חיבור" retry banner, a false empty
// state, and a redirect to the marketing homepage. These tests pin the single
// replacement, and pin the two lies (billing, header badge) shut.
//
// No DB: runs in the no-DB suite.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { EntitlementProvider } from '@/lib/entitlement/EntitlementContext'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { isAccessDenied, markAccessDenied, __resetAccessDeniedForTests } from '@/lib/entitlement/pollGate'
import ManagePlanModal from '@/components/settings/payment/ManagePlanModal'
import PaymentMethodRow from '@/components/settings/payment/PaymentMethodRow'
import RefreshLeadIntelligenceButton from '@/components/ai/RefreshLeadIntelligenceButton'
import type { SubscriptionClientView } from '@/components/settings/payment/ManagePlanLauncher'
import SuggestionChips from '@/components/copilot/general/SuggestionChips'
import { useAdaptivePoll } from '@/modules/inbox/client/useAdaptivePoll'

// The modal imports its two server actions at module scope. Neither is invoked
// by any assertion here — an expired customer is never offered cancellation,
// which is precisely what these tests pin.
vi.mock('@/actions/subscription', () => ({
  cancelRenewal: async () => ({ ok: true }),
  resumeRenewal: async () => ({ ok: true }),
}))

// The refresh button imports a requireProductAccess-guarded action at module
// scope. No assertion reaches it — the point is that an expired customer is
// never given the control that would call it.
vi.mock('@/actions/ai/leadIntelligenceRefresh', () => ({
  refreshLeadIntelligence: async () => ({ ok: true }),
}))

// The modal calls useRouter for the post-action refresh. No assertion here
// reaches an action, so a refresh spy is all the router needs to be.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => '/settings/update_payment',
  useSearchParams: () => new URLSearchParams(),
}))

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

const EXPIRED = { hasAccess: false, status: 'TRIAL_EXPIRED', expiresAt: '2026-08-20T20:03:27.824Z' }
const ACTIVE = { hasAccess: true, status: 'PAID', expiresAt: '2026-12-01T00:00:00.000Z' }

function renderState(value = EXPIRED, props = {}) {
  return render(
    <EntitlementProvider value={value}>
      <SubscriptionExpiredState {...props} />
    </EntitlementProvider>,
  )
}

afterEach(cleanup)

describe('the expired state says one thing, and never "try again"', () => {
  it('names the subscription as the cause', () => {
    renderState()
    expect(screen.getByText('המנוי שלך הסתיים')).toBeTruthy()
  })

  it('offers renewal through the EXISTING upgrade route', () => {
    renderState()
    const cta = screen.getByRole('link', { name: 'חידוש מנוי' })
    expect(cta.getAttribute('href')).toContain('/settings/update_payment')
  })

  /**
   * The CTA is a link. Rendering it must not create a pending upgrade or touch
   * subscription state — the write happens only when the customer clicks.
   */
  it('does not mutate anything merely by rendering', () => {
    const calls: string[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (...a: unknown[]) => {
      calls.push(String(a[0]))
      return Promise.reject(new Error('no network in test'))
    }
    renderState()
    globalThis.fetch = originalFetch
    expect(calls).toEqual([])
  })

  it('never offers a retry for a permanent refusal', () => {
    const { container } = renderState()
    const text = container.textContent ?? ''
    for (const forbidden of ['נסה שוב', 'בעיית חיבור', 'משהו השתבש']) {
      expect(text, `expired state must not say "${forbidden}"`).not.toContain(forbidden)
    }
  })

  it('reassures the customer their data is safe', () => {
    const { container } = renderState()
    expect(container.textContent).toContain('שמורים')
  })

  it('states when the subscription lapsed', () => {
    renderState()
    expect(screen.getByText(/תוקף המנוי הסתיים בתאריך/)).toBeTruthy()
  })

  it('uses different copy for a trial that never started', () => {
    renderState({ ...EXPIRED, status: 'NEVER_STARTED' })
    expect(screen.getByText(/הפעלת המנוי פותחת/)).toBeTruthy()
  })

  it('renders in all three densities', () => {
    for (const mode of ['page', 'panel'] as const) {
      cleanup()
      renderState(EXPIRED, { mode })
      expect(screen.getByTestId('subscription-expired-state')).toBeTruthy()
    }
    cleanup()
    renderState(EXPIRED, { mode: 'inline' })
    expect(screen.getByTestId('subscription-expired-inline')).toBeTruthy()
  })
})

describe('polling stops on entitlement denial, not on generic failure', () => {
  beforeEach(() => __resetAccessDeniedForTests())

  it('starts open', () => {
    expect(isAccessDenied()).toBe(false)
  })

  it('latches once a 403 is seen', () => {
    markAccessDenied()
    expect(isAccessDenied()).toBe(true)
  })

  it.each([
    ['modules/inbox/client/InboxSyncLoop.tsx', '[inbox.sync]'],
    ['modules/inbox/awareness/AwarenessContext.tsx', '[inbox.awareness]'],
    ['modules/notifications/NotificationPoller.tsx', '[notifications.feed]'],
  ])('%s checks the gate before fetching and latches only on 403', (file) => {
    const src = read(file)
    expect(src).toContain('if (isAccessDenied()) return')
    expect(src).toContain('if (res.status === 403) markAccessDenied()')
    // A generic 500 must stay a generic failure — never mistaken for expiry.
    expect(src).not.toMatch(/res\.status\s*>=\s*400.*markAccessDenied/)
  })
})

describe('the two surfaces that used to lie', () => {
  it('billing derives its status from entitlement, not the plan name', () => {
    const card = read('components/settings/payment/ProPlanCard.tsx')
    expect(card).toContain('hasAccess')
    expect(card).toContain('const expired = !hasAccess')
    expect(card).toContain('המנוי הסתיים')
    // "מנוי פעיל" must now be unreachable while expired.
    expect(card).toContain('if (expired)')

    const page = read('app/(app)/settings/(user_settings)/update_payment/page.tsx')
    expect(page).toContain('getAgencyProductAccess')
    expect(page).toContain('hasAccess={productAccess.hasAccess}')
  })

  it('the header PRO badge requires entitlement, not just plan==="pro"', () => {
    const layout = read('app/(app)/layout.tsx')
    expect(layout).toContain('isPro={productAccess.hasAccess &&')
    expect(layout).not.toMatch(/isPro=\{\(await getAgencyPlan\(user\.agencyId\)\) === 'pro'\}/)
  })
})

describe('entitlement is not authentication', () => {
  it('notifications keeps an expired user inside the app, and now shows the list', () => {
    const page = read('app/(app)/notifications/page.tsx')
    // The ejection to the marketing homepage is gone…
    expect(page).not.toMatch(/hasAccess\)\s*redirect\('\/'\)/)
    // …and so is the page-level lock that replaced it. Reading your own
    // notifications costs nothing, so Tier 2 shows them.
    expect(page).not.toContain('<SubscriptionExpiredState')
    expect(page).not.toContain('getAgencyProductAccess')
  })

  it('seeds entitlement from the existing guard, not a second calculation', () => {
    const layout = read('app/(app)/layout.tsx')
    expect(layout).toContain('getAgencyProductAccess(user.agencyId)')
    expect(layout).toContain('<EntitlementProvider')
    const ctx = read('lib/entitlement/EntitlementContext.tsx')
    // The client context must never compute access itself.
    expect(ctx).not.toContain('getTrialState')
    expect(ctx).not.toContain('expiresAt <')
  })

  it('defaults to access-granted so an unwrapped tree never locks the product', () => {
    render(<SubscriptionExpiredState />)
    // Renders on demand only; the provider default is hasAccess:true, asserted
    // by the context module itself.
    const ctx = read('lib/entitlement/EntitlementContext.tsx')
    expect(ctx).toContain('hasAccess: true')
  })

  it('an active subscription renders no expired affordance anywhere', () => {
    const { container } = render(
      <EntitlementProvider value={ACTIVE}>
        <div>שלום</div>
      </EntitlementProvider>,
    )
    expect(container.textContent).not.toContain('המנוי שלך הסתיים')
  })
})

describe('every gated surface uses the shared state, not a local invention', () => {
  const SURFACES: Array<[string, string]> = [
    ['components/copilot/general/GeneralModePanel.tsx', 'ai_panel'],
    ['components/clients/ClientFormPop.tsx', 'create_lead'],
    ['components/inbox/WhatsappComposerPanel.tsx', 'whatsapp_composer'],
    ['components/inbox/LeadlessConversationActions.tsx', 'conversation_actions'],
    ['app/(app)/settings/(user_settings)/integrations/page.tsx', 'integrations_page'],
    ['app/(app)/settings/(user_settings)/update_payment/page.tsx', 'billing_page'],
    // Notifications moved to Tier 2: the bell and the page now render the real
    // list for an expired customer, so neither carries a locked state at all.
  ]

  it.each(SURFACES)('%s renders SubscriptionExpiredState', (file, source) => {
    const src = read(file)
    expect(src).toContain('SubscriptionExpiredState')
    expect(src).toContain(source)
  })

  /**
   * The rule is about CLIENT code deciding ACCESS. `update_payment/page.tsx` is
   * a Server Component that uses `plan === 'pro'` to choose which view to render
   * (billing centre vs upgrade view) — a plan-name question, not an access one —
   * and separately reads getAgencyProductAccess for the access answer. So it is
   * excluded deliberately rather than by weakening the rule.
   */
  const CLIENT_SURFACES = SURFACES.filter(([f]) => !f.includes('update_payment'))

  it.each(CLIENT_SURFACES)('%s never derives access from the plan name', (file) => {
    expect(read(file)).not.toMatch(/plan\s*===\s*'pro'/)
  })

  it('billing uses the plan name only for view selection, never for access', () => {
    const src = read('app/(app)/settings/(user_settings)/update_payment/page.tsx')
    expect(src).toContain("const isPro = plan === 'pro'")
    // The ACCESS answer comes from the guard, and is what the card renders.
    expect(src).toContain('getAgencyProductAccess')
    expect(src).toContain('hasAccess={productAccess.hasAccess}')
  })
})

describe('the locked mutation surfaces actually block the mutation', () => {
  it('the AI panel replaces the composer rather than sending', () => {
    const src = read('components/copilot/general/GeneralModePanel.tsx')
    expect(src).toContain('const expired = useAccessDenied()')
    // The composer is the only path to askGeneralQuestion, and it is behind the gate.
    expect(src).toMatch(/expired \?[\s\S]{0,400}<GeneralComposer/)
  })

  it('create lead refuses before submitting, not after a 500', () => {
    const src = read('components/clients/ClientFormPop.tsx')
    expect(src).toContain('const expired = useAccessDenied()')
    expect(src).toMatch(/expired \?[\s\S]{0,400}<form id='clientForm'/)
  })

  it('the WhatsApp composer is locked before any send affordance renders', () => {
    const src = read('components/inbox/WhatsappComposerPanel.tsx')
    const gate = src.indexOf('if (expired)')
    const leadless = src.indexOf("decision.kind === 'leadless'")
    expect(gate).toBeGreaterThan(-1)
    // Must come first, so no template picker or text composer can slip through.
    expect(gate).toBeLessThan(leadless)
  })

  it('conversation history is NOT gated — only sending is', () => {
    // The composer panel is gated; the thread/message list must not be.
    const thread = read('modules/inbox/mobile/ConversationThreadMobile.tsx')
    expect(thread).not.toContain('SubscriptionExpiredState')
  })
})

describe('shared action runner distinguishes entitlement from a real bug', () => {
  it('returns the entitlement sentinel only when access is denied', () => {
    const src = read('lib/useAction.ts')
    expect(src).toContain('ENTITLEMENT_ERROR')
    expect(src).toContain("accessDenied ? ENTITLEMENT_ERROR : 'משהו השתבש, נסה שוב'")
  })

  it('conversation actions render the locked state instead of the retry line', () => {
    const src = read('components/inbox/LeadlessConversationActions.tsx')
    expect(src).toContain('error === ENTITLEMENT_ERROR')
    expect(src).toContain("error !== ENTITLEMENT_ERROR")
  })
})

describe('manage-plan offers renewal, not cancellation, to an expired customer', () => {
  it('renew is primary and cancel is withheld', () => {
    const src = read('components/settings/payment/ManagePlanModal.tsx')
    expect(src).toContain('חידוש מנוי')
    expect(src).toContain("upgradeHref('manage_plan_modal')")
    // Cancel paths are all suppressed while expired.
    expect(src).toContain("{!expired && manageable && status === 'active'")
    expect(src).toContain("{!expired && !manageable &&")
  })
})

describe('integrations separates connection health from entitlement', () => {
  it('keeps the connector copy and states the subscription fact once', () => {
    const page = read('app/(app)/settings/(user_settings)/integrations/page.tsx')
    expect(page).toContain('getAgencyProductAccess')
    expect(page).toContain('SubscriptionExpiredState')
    // The connectors themselves are untouched — their claim is true.
    expect(read('components/settings/WhatsappConnect.tsx')).toContain('החיבור תקין')
  })
})

describe('no mobile tab ejects an expired user', () => {
  it.each(['dashboard', 'leads', 'inbox', 'notifications', 'm'])('/%s has no redirect to "/"', (route) => {
    const src = read(`app/(app)/${route}/page.tsx`)
    // Comments may mention the old behaviour; executable code must not contain it.
    const code = src
      .split('\n')
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join('\n')
    expect(code).not.toContain("redirect('/')")
  })
})

describe('narrow audit: the five remaining surfaces', () => {
  it('WhatsappReplyDraft gates BEFORE the paid AI draft and before sending', () => {
    const src = read('components/summary/WhatsappReplyDraft.tsx')
    expect(src).toContain('const expired = useAccessDenied()')
    expect(src).toContain('whatsapp_reply_draft')
    // The gate must precede the component's JSX return, so neither
    // generateWhatsappReplyDraft nor sendWhatsappReply can be reached.
    const gate = src.indexOf("if (expired) {")
    const ret = src.lastIndexOf('  return (')
    expect(gate).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(ret)
    // And it must never show a retry line for a permanent refusal.
    expect(src).toContain('נסה שוב') // the ACTIVE-path copy still exists…
    expect(src).toContain('SubscriptionExpiredState') // …but expired short-circuits first
  })

  it('ConvertCommentButton shows entitlement UX, not its db_error retry copy', () => {
    const src = read('modules/facebookComments/components/ConvertCommentButton.tsx')
    expect(src).toContain('accessDenied')
    expect(src).toContain('convert_comment')
    const gate = src.indexOf('if (accessDenied)')
    expect(gate).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(src.lastIndexOf('  return ('))
  })

  /** Display-only: imports the TYPE, and its only handler is a local callback. */
  it('AnswerView is left untouched because it cannot trigger a paid operation', () => {
    const src = read('components/copilot/general/AnswerView.tsx')
    expect(src).toContain("import type { GeneralAnswer }")
    expect(src).not.toContain('SubscriptionExpiredState')
    expect(src).not.toMatch(/await\s+askGeneralQuestion/)
  })

  /** Leads export is client-side over data already in the browser. */
  it('leads export is left untouched because it makes no server call', () => {
    const exp = read('lib/table/export/index.tsx')
    expect(exp).toContain('if (data) return data')
    expect(exp).not.toContain('SubscriptionExpiredState')
    const table = read('components/clients/clientsTable.tsx')
    // The leads table passes `data`, never `dataToFetch`, so getData() short-circuits.
    expect(table).toMatch(/<ExportTable data=\{mergedState\} columns=\{columns\} \/>/)
  })

  /** Search is a pure read behind the entitlement guard — a product decision. */
  /**
   * The product decision landed: search, filter and sort are Tier 1. Finding
   * your own records reads and spends nothing, so the guard moved to the basic
   * boundary while the agency scoping stayed exactly as it was.
   */
  it('search is Tier 1, and still agency scoped', () => {
    const src = read('actions/clients.ts')
    expect(src).toMatch(/async function searchBase[\s\S]{0,400}requireBasicCrmAccess\(\)/)
    expect(src).toMatch(/async function searchBase[\s\S]{0,1200}getAgencyId\(\)/)
  })
})

describe('production audit follow-ups', () => {
  it('manage-plan reports EXPIRED status, not "פעיל", and no future billing date', () => {
    const src = read('components/settings/payment/ManagePlanModal.tsx')
    // "החיוב הבא" is reachable ONLY from a genuinely renewing subscription —
    // the single rule that also covers the non-Pro case, which used to fall
    // through the ternary chain to 'פעיל'.
    expect(src).toContain("const renewing = !expired && status === 'active'")
    expect(src).toContain("const dateLabel = renewing ? 'החיוב הבא'")
    expect(src).toContain("expired\n    ? 'המנוי הסתיים'")
    // The date must never be labelled as an upcoming charge while expired.
    expect(src).not.toMatch(/const dateLabel = cancelling \? 'גישה ל־Pro עד' : 'החיוב הבא'/)
    // Entitlement, never the plan name.
    expect(src).toContain('useAccessDenied()')
    expect(src).not.toMatch(/plan\s*===\s*'pro'/)
  })

  it('the sync banner separates a 403 entitlement stop from a real outage', () => {
    const src = read('components/clients/CrmSyncBanner.tsx')
    expect(src).toContain('isAccessDenied()')
    expect(src).toContain('SubscriptionExpiredState')
    // The generic connection copy and its retry must survive for non-403 failures.
    expect(src).toContain("t('leads.banners.syncProblem')")
    expect(src).toContain("t('leads.banners.retry')")
    // …but only AFTER the entitlement branch has returned. Compare against the
    // JSX occurrence, not the explanatory comment above the gate.
    const code = src
      .split('\n')
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join('\n')
    const gate = code.indexOf('if (isAccessDenied())')
    expect(gate).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(code.indexOf("t('leads.banners.syncProblem')"))
  })

  it('only a 403 latches the gate — a 500 stays a generic failure', () => {
    const gate = read('lib/entitlement/pollGate.ts')
    expect(gate).toContain('markAccessDenied')
    for (const f of [
      'modules/inbox/client/InboxSyncLoop.tsx',
      'modules/inbox/awareness/AwarenessContext.tsx',
      'modules/notifications/NotificationPoller.tsx',
    ]) {
      const src = read(f)
      expect(src).toContain('if (res.status === 403) markAccessDenied()')
      expect(src).not.toMatch(/res\.status\s*>=\s*[45]00[\s\S]{0,40}markAccessDenied/)
    }
  })

  /**
   * Proven against production data: every "—" message is media with `text: ''` —
   * originally `type: 'audio'` voice notes, and later the PDFs a print-shop
   * customer sent. Zero null-text rows in the sampled conversation. The em-dash
   * is a TEXT-ABSENCE fallback, NOT entitlement suppression — so read access is
   * correct and must not be "fixed".
   *
   * Media now renders as an attachment and an unsupported type gets an honest
   * notice, so the fallback no longer swallows files. The invariant this test
   * exists for is unchanged: the text branch is never gated by entitlement, and
   * "—" is still what a bodyless TEXT message shows.
   */
  it('message text is never gated by entitlement — the em-dash is absence, not suppression', () => {
    const src = read('components/summary/WhatsappConversation.tsx')
    // The body comes from the shared thread view (text, else caption); '—' marks an empty text message.
    expect(src).toContain('const body = messageBody(m)')
    expect(src).toContain("{body ?? '—'}")
    // The renderer must not consult entitlement for message BODIES.
    const textLine = src.indexOf("{body ?? '—'}")
    const before = src.slice(0, textLine)
    expect(before).not.toContain('useAccessDenied')
    expect(before).not.toContain('hasAccess')
    // Nor does the shared helper that decides the body.
    const view = read('lib/inbox/whatsappThreadView.ts')
    expect(view).not.toContain('useAccessDenied')
    expect(view).not.toContain('hasAccess')
  })

  it('the education tour does not open over a paywall', () => {
    const layout = read('app/(app)/layout.tsx')
    expect(layout).toContain('productAccess.hasAccess && !trialExpired')
    // Active accounts keep tours: the other conditions are still present.
    expect(layout).toContain("trialStatus !== 'NEVER_STARTED'")
    expect(layout).toContain('!mobileWorkspace')
  })
})

/* ------------------------------------------------------------------------- *
 * Browser-audit follow-ups.
 *
 * Everything below was found by driving the real product against the real
 * expired account — desktop and a genuine mobile user-agent — not by reading
 * source. Each test pins a fact the browser proved was wrong.
 * ------------------------------------------------------------------------- */

const PRO_ROW: SubscriptionClientView = {
  plan: 'pro',
  expiresAtIso: '2026-08-20T20:03:27.824Z',
  cancelAtPeriodEnd: false,
  status: 'active',
  manageable: true,
}

function renderManagePlan(entitlement: typeof EXPIRED, subscription = PRO_ROW) {
  return render(
    <EntitlementProvider value={entitlement}>
      <ManagePlanModal open onClose={() => {}} subscription={subscription} />
    </EntitlementProvider>,
  )
}

describe('manage-plan never reports an expired subscription as active', () => {
  /**
   * Observed live on production, on desktop AND on an iPhone user-agent:
   * "החיוב הבא: 20/8/2026" and "סטטוס: פעיל" — a date already in the past,
   * presented as the next charge, to a customer whose access had lapsed.
   */
  it('says the subscription ended, and never that it is active', () => {
    renderManagePlan(EXPIRED)
    expect(screen.getByText('סטטוס: המנוי הסתיים')).toBeTruthy()
    expect(screen.queryByText('סטטוס: פעיל')).toBeNull()
  })

  it('relabels the date as an end, and never as a next charge', () => {
    renderManagePlan(EXPIRED)
    expect(screen.getByText(/^המנוי הסתיים ב:/)).toBeTruthy()
    expect(document.body.textContent).not.toContain('החיוב הבא')
  })

  it('offers renewal and withholds cancellation', () => {
    renderManagePlan(EXPIRED)
    expect(screen.getByRole('link', { name: 'חידוש מנוי' }).getAttribute('href')).toContain(
      '/settings/update_payment',
    )
    expect(screen.queryByRole('button', { name: 'בטל מנוי' })).toBeNull()
  })

  /** Rendering the CTA is a link render. It must not touch billing state. */
  it('does not call the network merely by opening', () => {
    const calls: string[] = []
    const original = globalThis.fetch
    globalThis.fetch = (...a: unknown[]) => {
      calls.push(String(a[0]))
      return Promise.reject(new Error('no network in test'))
    }
    renderManagePlan(EXPIRED)
    globalThis.fetch = original
    expect(calls).toEqual([])
  })

  /**
   * The same ternary chain that mislabelled expired also fell through to
   * 'פעיל' for a plan that is not Pro at all.
   */
  it('does not call a non-Pro plan active either', () => {
    renderManagePlan(ACTIVE, { ...PRO_ROW, plan: 'free' })
    expect(screen.queryByText('סטטוס: פעיל')).toBeNull()
    expect(screen.getByText('סטטוס: לא פעיל')).toBeTruthy()
  })

  it('leaves a genuinely renewing subscription exactly as it was', () => {
    renderManagePlan(ACTIVE)
    expect(screen.getByText('סטטוס: פעיל')).toBeTruthy()
    expect(screen.getByText(/^החיוב הבא:/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'בטל מנוי' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'חידוש מנוי' })).toBeNull()
  })
})

describe('the poll contract: a 403 is a terminal business state, not an outage', () => {
  const POLLERS = [
    'modules/inbox/client/InboxSyncLoop.tsx',
    'modules/inbox/awareness/AwarenessContext.tsx',
    'modules/notifications/NotificationPoller.tsx',
  ]

  /**
   * The latched gate used to `return` bare. `useAdaptivePoll` read `.failed`
   * off undefined, threw, and counted a failure — three ticks later the user
   * saw "בעיית חיבור — מנסה שוב" for a subscription lapse, with no request in
   * flight at all. `strictNullChecks` is off repo-wide, so the compiler could
   * never have caught this. These assertions are the compiler.
   */
  it.each(POLLERS)('%s returns the full result object when the gate is latched', (p) => {
    const src = read(p)
    expect(src).toContain('if (isAccessDenied()) return { changed: false, failed: false }')
    expect(src).not.toMatch(/if \(isAccessDenied\(\)\) return\s*$/m)
  })

  it.each(POLLERS)('%s still reports a genuine transport failure as failed', (p) => {
    expect(read(p)).toContain('return { changed: false, failed: true }')
  })
})

describe('useAdaptivePoll counts failures honestly', () => {
  function probe(pollFn: () => Promise<{ changed: boolean; failed?: boolean }>) {
    const seen: number[] = []
    function Probe() {
      useAdaptivePoll(pollFn, { onConsecutiveFailures: (n) => seen.push(n) })
      return null
    }
    render(<Probe />)
    return seen
  }

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('an entitlement stop is a healthy tick, not a failure', async () => {
    const seen = probe(async () => ({ changed: false, failed: false }))
    await vi.advanceTimersByTimeAsync(700)
    expect(seen.at(-1)).toBe(0)
  })

  it('a poll that returns nothing cannot fabricate an outage', async () => {
    const seen = probe(async () => undefined as never)
    await vi.advanceTimersByTimeAsync(700)
    expect(seen.at(-1)).toBe(0)
  })

  it('a real 5xx/network failure still counts, and keeps counting', async () => {
    const seen = probe(async () => ({ changed: false, failed: true }))
    await vi.advanceTimersByTimeAsync(700)
    expect(seen.at(-1)).toBe(1)
    await vi.advanceTimersByTimeAsync(8000)
    expect(seen.at(-1)!).toBeGreaterThanOrEqual(2)
  })

  it('a thrown poll still counts as a failure', async () => {
    const seen = probe(async () => {
      throw new Error('network down')
    })
    await vi.advanceTimersByTimeAsync(700)
    expect(seen.at(-1)).toBe(1)
  })
})

describe('getDailyBriefing returns entitlement, it does not throw it', () => {
  const src = () => read('actions/ai/getDailyBriefing.ts')

  /**
   * The panel mounts on every app route, so the escaping throw produced an
   * opaque Server Action 500 (React #441) on every page load of an expired
   * account — observed twice per page in production, for a state the UI was
   * already rendering correctly.
   */
  it('converts the typed refusal into a value the UI can render', () => {
    expect(src()).toContain('ProductAccessError')
    expect(src()).toContain("return { kind: 'locked' }")
  })

  it('does not weaken the guard', () => {
    expect(src()).toContain('await requireProductAccess()')
  })

  it('still lets a real bug through instead of laundering it as "locked"', () => {
    expect(src()).toMatch(/if \(err instanceof ProductAccessError\) return null\s*\n\s*throw err/)
  })

  it('the locked outcome is part of the briefing type, not an ad-hoc shape', () => {
    expect(read('lib/copilot/general/types.ts')).toContain("{ kind: 'locked' }")
  })

  it('the panel renders the shared locked state for it, and no composer', () => {
    const panel = read('components/copilot/general/GeneralModePanel.tsx')
    expect(panel).toContain("briefing?.kind === 'locked'")
    expect(panel).toContain('{serverLocked && (')
    // `!serverLocked` is the term that enforces "no composer while locked" and is
    // asserted verbatim below. The gate no longer carries `!isEmptySystem`: a
    // zero-lead workspace is a DATA state and must keep an interactive composer,
    // which is a separate concern from entitlement. The locked guarantee is
    // unchanged and is additionally covered behaviourally in
    // __tests__/ai/general-mode-zero-leads.test.tsx.
    expect(panel).toContain('{!serverLocked && briefing && (')
  })
})

describe('leadless conversation actions gate before the mutation, not after it', () => {
  const src = () => read('components/inbox/LeadlessConversationActions.tsx')

  /**
   * Production showed "+ צור ליד" and "קשר לליד קיים" fully enabled on an
   * expired account. Every action behind them is requireProductAccess-guarded,
   * so the customer could only discover that by clicking and failing.
   */
  it('returns the locked state before any action button is rendered', () => {
    const s = src()
    const gate = s.indexOf('if (expired) {')
    const firstButton = s.indexOf('onClick={onCreate}')
    expect(gate).toBeGreaterThan(-1)
    expect(firstButton).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(firstButton)
  })

  it('reads entitlement from the shared context, not a local rule', () => {
    expect(src()).toContain("useAccessDenied } from '@/lib/entitlement/EntitlementContext'")
  })

  it('keeps the post-hoc entitlement branch as the stale-context backstop', () => {
    expect(src()).toContain('error === ENTITLEMENT_ERROR')
  })

  it('leaves the active-user path untouched', () => {
    const s = src()
    expect(s).toContain('onClick={onCreate}')
    expect(s).toContain('onClick={onLinkClick}')
    expect(s).toContain('onClick={onPersonal}')
  })
})

describe('locked AI controls are unreachable, not merely un-clickable', () => {
  /**
   * The audit found AI quick questions with `pointer-events: none` and an
   * `aria-hidden` ancestor — but `tabIndex 0`. CSS stopped the mouse; the tab
   * key still reached a paid control the product had just suspended.
   */
  it('a locked quick question leaves the tab order', () => {
    render(<SuggestionChips items={['מי צריך מעקב היום']} onPick={() => {}} disabled />)
    const chip = screen.getByRole('button', { name: 'מי צריך מעקב היום' }) as HTMLButtonElement
    expect(chip.disabled).toBe(true)
  })

  it('an active user keeps them interactive', () => {
    const picked: string[] = []
    render(<SuggestionChips items={['מי צריך מעקב היום']} onPick={(t) => picked.push(t)} />)
    const chip = screen.getByRole('button', { name: 'מי צריך מעקב היום' }) as HTMLButtonElement
    expect(chip.disabled).toBe(false)
    chip.click()
    expect(picked).toEqual(['מי צריך מעקב היום'])
  })

  it('the panel disables them on entitlement, not on CSS', () => {
    expect(read('components/copilot/general/GeneralModePanel.tsx')).toContain('disabled={expired}')
  })

  /** A closed panel must not hold focusable controls inside an aria-hidden subtree. */
  it('the closed copilot shell is inert, not just aria-hidden', () => {
    const shell = read('components/copilot/CopilotShell.tsx')
    expect(shell).toContain('aria-hidden={!open}')
    expect(shell).toContain('inert={!open}')
  })
})

describe('GET /api/payments/upgrade is retired, and no longer writes', () => {
  /**
   * The audit recorded, but could not fix from an expired-UX pass, that this
   * GET had write side effects: six `upgrade_clicked` rows and a
   * pending_upgrades write appeared during the browser audit without any CTA
   * being clicked, because a GET with side effects is reachable by any
   * prefetcher, scanner or link preview.
   *
   * Removing Payment Links fixed it. The route is a redirect to the billing
   * screen; the only write left is the analytics row, which is what the
   * prefetch noise was about but is not state a customer can be billed on.
   */
  it('no longer writes pending_upgrades on GET', () => {
    const route = read('app/api/payments/upgrade/route.ts')
    expect(route).toContain('export async function GET(')
    expect(route).not.toContain("db('pending_upgrades')")
    expect(route).not.toContain('export async function POST(')
  })

  it('sends the customer to the billing screen and to no payment provider', () => {
    const route = read('app/api/payments/upgrade/route.ts')
    expect(route).toContain("'/settings/update_payment'")
    expect(route).not.toContain('getUpgradeLink')
    expect(route).not.toContain('GROW_PAYMENT_LINK')
  })

  it('takes no money and changes no subscription by itself', () => {
    const route = read('app/api/payments/upgrade/route.ts')
    expect(route).not.toContain("db('subscriptions')")
    expect(route).not.toContain("db('payments')")
    expect(route).not.toContain("db('agencies')")
  })
})

/* ------------------------------------------------------------------------- *
 * Final narrow audit: the AI summary card and the last billing sentence.
 * ------------------------------------------------------------------------- */

describe('the lead summary card reads the entitlement reason it was already given', () => {
  const card = () => read('components/ai/LeadIntelligenceCard.tsx')

  /**
   * `runStructured` resolves product access through the same
   * getAgencyProductAccess the rest of the app uses and returns a TYPED reason
   * for it, before any provider is chosen. This card recognised 'disabled' and
   * 'forbidden' and let the two entitlement reasons fall through to a generic
   * retry line — the one the production audit caught on the lead page.
   */
  /**
   * Superseded twice. First by the one-notice-per-screen rule, which stopped
   * this card from carrying a second banner; then by "don't hide the value,
   * hide the cost", which stopped it from vanishing. Both entitlement reasons
   * now answer with the teaser, and neither adds standing subscription copy.
   * Full coverage lives in leadIntelligenceTeaser.test.tsx.
   */
  it('teases the value for either entitlement reason', () => {
    const src = card()
    expect(src).toContain("if (res.reason === 'subscription-required' || res.reason === 'trial-not-started') {")
    expect(src).toContain('return <LeadIntelligenceTeaser />')
    expect(src).not.toContain('SubscriptionExpiredState')
  })

  it('keeps the retry line for genuine AI failures', () => {
    expect(card()).toContain('העוזר החכם לא זמין כרגע. נסו שוב בעוד דקה.')
  })

  it('still renders nothing when AI is off or the agency is not allowlisted', () => {
    expect(card()).toContain("if (res.reason === 'disabled' || res.reason === 'forbidden') return null")
  })

  it('withholds the refresh control from the entitlement branch', () => {
    const src = card()
    const gated = src.indexOf("res.reason === 'subscription-required'")
    // Both refresh controls render only after the entitlement branch returned.
    expect(gated).toBeGreaterThan(-1)
    for (const at of [...src.matchAll(/<RefreshLeadIntelligenceButton/g)].map((m) => m.index!)) {
      expect(at).toBeGreaterThan(gated)
    }
    // …and the control gates itself, for the stale-cache case where a real
    // summary from before the lapse still renders.
    expect(read('components/ai/RefreshLeadIntelligenceButton.tsx')).toContain('if (expired) return null')
  })

  it('the AI access decision is the shared resolver, not a second entitlement system', () => {
    const access = read('lib/ai/access.ts')
    expect(access).toContain("import { getAgencyProductAccess } from '@/lib/access/productAccess'")
    expect(access).not.toContain('getTrialState')
    // The router asks it before choosing a provider, so no paid call is made.
    const router = read('lib/ai/gate.ts')
    const gate = router.indexOf('const access = await resolveAiAccess')
    const providers = router.indexOf('if (!hasAnyProviderConfigured())')
    expect(gate).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(providers)
  })
})

describe('a cached summary outlives the subscription, its refresh does not', () => {
  it('withholds the refresh control while access is lapsed', () => {
    const { container } = render(
      <EntitlementProvider value={EXPIRED}>
        <RefreshLeadIntelligenceButton leadId={1} />
      </EntitlementProvider>,
    )
    expect(container.textContent).toBe('')
    expect(screen.queryByRole('button', { name: 'רענן תובנות' })).toBeNull()
  })

  it('leaves it exactly as it was for an active subscription', () => {
    render(
      <EntitlementProvider value={ACTIVE}>
        <RefreshLeadIntelligenceButton leadId={1} />
      </EntitlementProvider>,
    )
    expect(screen.getByRole('button', { name: 'רענן תובנות' })).toBeTruthy()
  })
})

describe('billing never promises a charge that is not coming', () => {
  it('does not claim a next charge once access has lapsed', () => {
    const { container } = render(<PaymentMethodRow state='expired' />)
    expect(container.textContent).not.toContain('החיוב הבא')
    expect(container.textContent).toContain('חידוש המנוי יחייב את הכרטיס')
  })

  /**
   * A cancelling customer still has access, so `expired` is false — but
   * "החיוב הבא" was equally untrue for them, on the same row.
   *
   * The positive half of this assertion changed. It used to require the row to
   * read "לא ייגבה חיוב נוסף", which pinned a promise the system cannot keep:
   * cancelling sets a flag on our own subscriptions row and contacts no payment
   * provider, so a further charge remains possible. The row now records the
   * request and predicts nothing, and this test pins THAT — while keeping the
   * original "no next charge is claimed" guarantee, which is still the point.
   */
  it('predicts no charge either way for a cancelling subscription', () => {
    const { container } = render(<PaymentMethodRow state='cancelling' />)
    expect(container.textContent).not.toContain('החיוב הבא')
    expect(container.textContent).toContain('בקשת הביטול נקלטה')
    // The promise that replaced it must not come back under either polarity.
    expect(container.textContent).not.toContain('לא ייגבה חיוב נוסף')
  })

  it('keeps the stored-card fact, which is still true in every state', () => {
    for (const state of ['renewing', 'cancelling', 'expired'] as const) {
      cleanup()
      const { container } = render(<PaymentMethodRow state={state} />)
      expect(container.textContent).toContain('אמצעי התשלום שמור אצל ספק הסליקה')
    }
  })

  it('leaves the renewing customer copy verbatim', () => {
    const { container } = render(<PaymentMethodRow />)
    expect(container.textContent).toContain('החיוב הבא ייגבה מהכרטיס ששימש לתשלום האחרון')
  })

  it('the card drives every state from subscription state, not the plan name', () => {
    const src = read('components/settings/payment/ProPlanCard.tsx')
    /*
     * A fourth state joined the three: 'granted'. An explicit Pro grant has no
     * subscription, so "next charge" / "cancellation received" / "renewing will
     * charge" are all inventions on it — see PaymentMethodRow.
     *
     * The guarantee is unchanged and still pinned below: the row is chosen from
     * entitlement and subscription state, never from the plan NAME, and
     * `expired` still comes from hasAccess rather than agencies.plan.
     */
    expect(src).toContain(
      "<PaymentMethodRow state={granted ? 'granted' : expired ? 'expired' : cancelling ? 'cancelling' : 'renewing'} />",
    )
    expect(src).toContain('const expired = !hasAccess')
    expect(src).toContain("const granted = subscription.source === 'grant'")
  })
})

describe('surfaces the sweep deliberately left alone', () => {
  /** Already correct: entitlement reasons are named, and cannot offer a retry. */
  it('the copilot timeline names the subscription and withholds retry', () => {
    const labels = read('components/copilot/bodies/labels.ts')
    expect(labels).toContain("'subscription-required':")
    expect(labels).toContain("'trial-not-started':")
    const body = read('components/copilot/bodies/ErrorBody.tsx')
    expect(body).toContain(
      "const canRetry = reason === 'all-providers-failed' || reason === 'invalid-input' || reason === 'unknown'",
    )
  })

  /** Genuine operational errors: these actions are not entitlement-guarded. */
  it('conversation delete stays a real error, because it is one', () => {
    expect(read('modules/inbox/actions.ts')).not.toContain('requireProductAccess')
    expect(read('components/inbox/DeleteConversationMenu.tsx')).toContain('מחיקת השיחה נכשלה. נסה שוב.')
  })

  it('the notifications list renders for an expired customer', () => {
    const page = read('app/(app)/notifications/page.tsx')
    expect(page).toContain('<NotificationCenter')
    expect(page).not.toContain('<SubscriptionExpiredState')
  })

  it('the bell panel shows notifications instead of a paywall', () => {
    const panel = read('components/notifications/NotificationPanel.tsx')
    expect(panel).not.toContain('useAccessDenied')
    // An empty panel means "you are up to date", never "your plan ended".
    expect(panel).toContain('אין התראות חדשות')
  })
})

/* ------------------------------------------------------------------------- *
 * Final pass: the toast-based mutation paths.
 *
 * These surfaces all shared one shape — a requireProductAccess-guarded action
 * behind a live control, whose refusal reached the customer as a generic retry
 * toast or (worse) an unhandled Server Action rejection. Each is now pre-gated,
 * so no doomed request is sent at all.
 * ------------------------------------------------------------------------- */

describe('pure-configuration settings pages lock instead of failing per click', () => {
  const PAGES: Array<[string, string]> = [
    ['app/(app)/settings/(admin_settings)/automation-templates/page.tsx', 'automation_templates_settings'],
    ['app/(app)/settings/(admin_settings)/automations/page.tsx', 'automations_settings'],
    ['app/(app)/settings/(admin_settings)/quote-templates/page.tsx', 'quote_templates_settings'],
    ['app/(app)/settings/(admin_settings)/auto-response/page.tsx', 'auto_response_settings'],
  ]

  it.each(PAGES)('%s stays readable and teases Pro instead of locking', (file, source) => {
    const src = read(file)
    expect(src).toContain('getAgencyProductAccess(user.agencyId)).hasAccess')
    expect(src).toContain(`source='${source}'`)
    // Tier 2: an inline notice above the real page, never a page-level wall.
    expect(src).toContain("mode='inline'")
    expect(src).not.toContain("mode='page'")
    expect(src).toContain('proLocked')
  })

  /**
   * Identity outranks commercial state: telling someone who could never use a
   * page that their subscription ended is simply the wrong sentence.
   */
  it.each([
    ['app/(app)/settings/(admin_settings)/automation-templates/page.tsx', 'isAutomationsAgencyAllowlisted'],
    ['app/(app)/settings/(admin_settings)/automations/page.tsx', 'isAutomationsAgencyAllowlisted'],
    ['app/(app)/settings/(admin_settings)/quote-templates/page.tsx', 'canManageQuoteTemplates'],
  ])('%s checks permission before entitlement', (file, permission) => {
    const src = read(file)
    expect(src.indexOf(permission)).toBeLessThan(src.indexOf('getAgencyProductAccess(user.agencyId)).hasAccess'))
  })

  it('auto-response leaves the mobile branch ahead of the gate, untouched', () => {
    const src = read('app/(app)/settings/(admin_settings)/auto-response/page.tsx')
    expect(src.indexOf('isMobileWorkspaceRequest')).toBeLessThan(
      src.indexOf('getAgencyProductAccess(user.agencyId)).hasAccess'),
    )
  })

  it('uses the existing resolver, never a second entitlement calculation', () => {
    for (const [file] of PAGES) {
      const src = read(file)
      expect(src).toContain("from '@/lib/access/productAccess'")
      expect(src).not.toContain('getTrialState')
    }
  })
})

describe('the copilot composer is gated, so no doomed ask or upload is sent', () => {
  const panel = () => read('components/copilot/CopilotPanel.tsx')

  /**
   * This composer is the single entry to BOTH `leadAskQuestion` and the
   * `getPresigned`/`addFiles` upload behind runComposerSubmit. Ungated, an
   * expired customer got "משהו השתבש. נסה שוב." for the question and
   * "העלאת הקבצים נכשלה. נסה שוב." for the attachment.
   */
  it('replaces the composer with the shared locked state', () => {
    const src = panel()
    expect(src).toContain('const expired = useAccessDenied()')
    expect(src).toContain("source='copilot_panel'")
    expect(src).toMatch(/expired \? \(\s*<SubscriptionExpiredState/)
  })

  it('keeps the timeline above it readable', () => {
    const src = panel()
    expect(src.indexOf('<CopilotTimeline')).toBeLessThan(src.indexOf('<SubscriptionExpiredState'))
  })

  it('the upload path has exactly one entry, so gating the composer covers it', () => {
    expect(read('components/copilot/composer/submitComposer.ts')).toContain('uploadCopilotAttachments')
    expect(read('lib/copilot/uploadAttachments.ts')).toContain("from '@/actions/files'")
    // Both file actions are requireProductAccess-guarded — the reason the
    // upload could never have succeeded for an expired customer.
    const files = read('actions/files.ts')
    expect(files).toMatch(/export async function getPresigned[\s\S]{0,120}requireProductAccess\(\)/)
    expect(files).toMatch(/export async function addFiles\(\{[\s\S]{0,120}requireProductAccess\(\)/)
  })

  it('leaves the generic upload error in place for real failures', () => {
    expect(read('components/copilot/composer/submitComposer.ts')).toContain('העלאת הקבצים נכשלה. נסה שוב.')
  })
})

describe('lead Drive keeps the files and withholds the mutations', () => {
  const section = () => read('components/clientPage/LeadDriveSection.tsx')

  it('withholds attach while the subscription is lapsed', () => {
    const src = section()
    expect(src).toContain("{!expired && <Btn lbl='צרף קובץ מ-Drive'")
    expect(src).toContain("source='lead_drive'")
  })

  it('withholds the suggestion rows, which are attach affordances too', () => {
    expect(section()).toContain('{!expired && !pickerEnabled && suggestions.length > 0 && (')
  })

  it('keeps the attached list rendering, because reading never lapses', () => {
    const src = section()
    expect(src).toContain('{attachments.length > 0 && (')
    expect(src).not.toContain('{!expired && attachments.length > 0')
  })

  it('keeps "פתח" and withholds only detach and re-pick', () => {
    const row = read('components/clientPage/LeadDriveAttachedRow.tsx')
    expect(row).toContain("<Btn lbl='פתח'")
    expect(row).toContain("{!expired && <Btn lbl='הסר'")
    expect(row).toContain('{!expired && pickerEnabled && leadId != null && (')
  })

  it('keeps the generic failure copy for real errors', () => {
    expect(section()).toContain('הצירוף נכשל. נסה שוב.')
  })
})

describe('the calendar stays readable and stops offering doomed mutations', () => {
  const view = () => read('components/calendar/CalendarView.tsx')

  /**
   * Superseded by the calendar read/write decision: the affordances stay live
   * so the customer meets the boundary deliberately and is answered by the Pro
   * prompt, instead of finding controls quietly absent. Depth lives in
   * calendarExpiredAccess.test.tsx.
   */
  it('keeps create, drag and resize live, and answers them with the Pro prompt', () => {
    const src = view()
    expect(src).toContain("<Btn lbl='פגישה חדשה' onClick={() => openNewMeeting()} />")
    expect(src).toContain('selectable={true}')
    expect(src).toContain('editable={true}')
    expect(src).toContain('if (expired) return promptCreate()')
    expect(src).toContain('return promptMove()')
  })

  /**
   * Final product decision: Calendar carries no standing subscription banner.
   * It is a working CRM surface, and the Pro boundary is met on the way into a
   * paid action rather than announced above readable data.
   */
  it('carries no persistent subscription notice', () => {
    const src = view()
    expect(src).not.toContain('SubscriptionExpiredState')
    expect(src).not.toContain("source='calendar'")
    // The boundary lives in the handlers instead.
    expect(src).toContain('if (expired) return promptCreate()')
  })

  it('still renders the meetings themselves', () => {
    const src = view()
    expect(src).toContain('const events: EventInput[] = useMemo')
    expect(src).not.toContain('if (expired) return null')
  })

  it('the details dialog shows the meeting as it is, and prompts on every write', () => {
    const dlg = read('components/calendar/MeetingDetailsDialog.tsx')
    // Derived from the meeting alone: expiry never restyles the record.
    expect(dlg).toContain("const canRetry = meeting.syncStatus === 'failed'")
    expect(dlg).toContain("const isScheduled = meeting.status === 'scheduled'")
    expect(dlg).toContain('onClick={expired ? promptEdit : onEdit}')
    expect(dlg).toContain('{formatDateTime(meeting.startAt)}')
  })

  it('leaves the genuine calendar error copy alone', () => {
    expect(read('components/calendar/hooks/useMeetingOutcomeActions.ts')).toContain('אירעה שגיאה. נסה שוב.')
  })
})

/* ------------------------------------------------------------------------- *
 * Closure pass: lead controls, invoices, deals and uploads.
 *
 * The last group of requireProductAccess-guarded mutations reachable from an
 * expired account. Every one is now pre-gated, so no doomed request is sent;
 * every corresponding read is preserved.
 * ------------------------------------------------------------------------- */

describe('lead follow-up and outcome controls gate before dispatch', () => {
  // OutcomeControl left this list when call outcomes were ratified as Tier 1:
  // a disposition on an existing lead spends nothing, and the automation it may
  // emit is refused at the engine.
  const CONTROLS: Array<[string, string]> = [['components/leads/FollowUpControl.tsx', 'lead_followup']]

  /**
   * Both dispatch inside `startTransition` with NO catch, so on a lapsed
   * subscription the click was an unhandled Server Action rejection: nothing
   * happened, and nothing said why.
   */
  it.each(CONTROLS)('%s reads the shared entitlement answer', (file) => {
    expect(read(file)).toContain('const expired = useAccessDenied()')
  })

  it.each(CONTROLS)('%s explains itself in the full variant', (file, source) => {
    const src = read(file)
    expect(src).toContain(`source='${source}'`)
    expect(src).toContain("mode='inline'")
  })

  it('the outcome control is open to an expired customer', () => {
    const src = read('components/leads/OutcomeControl.tsx')
    expect(src).not.toContain('useAccessDenied')
    expect(src).toContain('logLeadOutcome')
  })

  /** Tier 2: the scheduled follow-up is the customer's own data and stays visible. */
  it('the follow-up control still shows an existing follow-up date', () => {
    const src = read('components/leads/FollowUpControl.tsx')
    expect(src).toContain('const scheduled = current ?')
    expect(src).toContain('{scheduled}')
  })

  it.each([
    ['components/leads/FollowUpControl.tsx', "data-edu='lead-followup'"],
    // The label moved to the i18n catalog (Phase B); its JSX call site is the same anchor.
    ['components/leads/OutcomeControl.tsx', "t('leads.outcome.titleLabel')"],
  ])('%s gates before its controls render, not after a click fails', (file, marker) => {
    const src = read(file)
    expect(src.indexOf('if (expired) {')).toBeLessThan(src.indexOf(marker))
  })
})

describe('invoice mutations are withheld while the records stay readable', () => {
  it('issuing is gated, and the generic issue error stays for real failures', () => {
    const src = read('components/billing/IssueInvoiceBtn.tsx')
    expect(src).toContain('const expired = useAccessDenied()')
    expect(src).toContain("source='invoice_issue'")
    expect(src).toContain('issueErrorMessage(reason)')
  })

  it('sending is gated inside the modal, so both triggers are covered', () => {
    const src = read('components/billing/SendInvoiceModal.tsx')
    expect(src).toContain('const expired = useAccessDenied()')
    expect(src).toContain("source='invoice_send'")
    // The real failure copy is untouched.
    expect(src).toContain('שליחת החשבונית נכשלה')
  })

  it('the new-invoice route locks, because creating is all it does', () => {
    const src = read('app/(app)/clients/[clientId]/billing/new/page.tsx')
    expect(src).toContain('getAgencyProductAccess(user.agencyId)).hasAccess')
    expect(src).toContain("source='invoice_new'")
    // Identity still outranks commercial state.
    expect(src.indexOf('canDraftBilling(user)')).toBeLessThan(
      src.indexOf('getAgencyProductAccess(user.agencyId)).hasAccess'),
    )
  })

  it('the billing tab itself is NOT gated — existing invoices stay readable', () => {
    const tab = read('app/(app)/clients/[clientId]/billing/page.tsx')
    expect(tab).not.toContain('SubscriptionExpiredState')
  })
})

describe('closing a deal and uploading files gate at their single choke point', () => {
  it('SaleForm gates once, covering all three entries', () => {
    const src = read('components/sales/saleForm/SaleForm.tsx')
    expect(src).toContain('const expired = useAccessDenied()')
    expect(src).toContain("source='close_deal'")
    expect(src.indexOf('if (expired) {')).toBeLessThan(src.indexOf('<form ref={formRef}'))
  })

  it('FileUploader gates the one path every upload runs through', () => {
    const src = read('components/files/FileUploader.tsx')
    expect(src).toContain('const expired = useAccessDenied()')
    expect(src).toContain("source='file_upload'")
    // Authentication still comes first.
    expect(src.indexOf('if (!user) return null')).toBeLessThan(src.indexOf('if (expired) {'))
  })

  it('both file actions behind it are guarded — the reason it could never succeed', () => {
    const files = read('actions/files.ts')
    expect(files).toMatch(/export async function getPresigned[\s\S]{0,120}requireProductAccess\(\)/)
    expect(files).toMatch(/export async function addFiles\(\{[\s\S]{0,120}requireProductAccess\(\)/)
  })

  it('the generic upload failure copy survives for real errors', () => {
    expect(read('components/files/funcs.tsx')).toContain('getPresigned')
    expect(read('components/files/FileUploader.tsx')).toContain('העלאת הקבצים נכשלה: ')
  })
})

describe('no new entitlement mechanism was introduced anywhere in this workstream', () => {
  it('every gated surface reads the one resolver or the one context', () => {
    const FILES = [
      'components/leads/FollowUpControl.tsx',
      'components/billing/IssueInvoiceBtn.tsx',
      'components/billing/SendInvoiceModal.tsx',
      'components/sales/saleForm/SaleForm.tsx',
      'components/files/FileUploader.tsx',
      'app/(app)/clients/[clientId]/billing/new/page.tsx',
    ]
    for (const f of FILES) {
      const src = read(f)
      const usesContext = src.includes("from '@/lib/entitlement/EntitlementContext'")
      const usesResolver = src.includes("from '@/lib/access/productAccess'")
      expect(usesContext || usesResolver, `${f} must reuse the existing entitlement source`).toBe(true)
      expect(src).not.toContain('getTrialState')
      expect(src).not.toContain('isPaidPeriodActive')
    }
  })
})
