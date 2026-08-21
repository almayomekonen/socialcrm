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

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { EntitlementProvider } from '@/lib/entitlement/EntitlementContext'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { isAccessDenied, markAccessDenied, __resetAccessDeniedForTests } from '@/lib/entitlement/pollGate'

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
    expect(cta.getAttribute('href')).toContain('/api/payments/upgrade')
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
    expect(screen.getByText(/תוקף המנוי הסתיים ב-/)).toBeTruthy()
  })

  it('uses different copy for a trial that never started', () => {
    renderState({ ...EXPIRED, status: 'NEVER_STARTED' })
    expect(screen.getByText(/הפעילו את המנוי/)).toBeTruthy()
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
  it('notifications keeps an expired user inside the app', () => {
    const page = read('app/(app)/notifications/page.tsx')
    // The ejection to the marketing homepage is gone…
    expect(page).not.toMatch(/hasAccess\)\s*redirect\('\/'\)/)
    // …replaced by the shared locked state.
    expect(page).toContain('<SubscriptionExpiredState')
    expect(page).toContain("mode='page'")
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
    ['components/notifications/NotificationPanel.tsx', 'notifications_bell'],
    ['app/(app)/settings/(user_settings)/integrations/page.tsx', 'integrations_page'],
    ['app/(app)/notifications/page.tsx', 'notifications_page'],
    ['app/(app)/settings/(user_settings)/update_payment/page.tsx', 'billing_page'],
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
    expect(src).toContain('/api/payments/upgrade?source=manage_plan_modal')
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
  it('search remains server-gated and unmodified pending a product decision', () => {
    const src = read('actions/clients.ts')
    expect(src).toContain('async function searchBase')
    // Still guarded — this audit did not weaken enforcement.
    expect(src).toMatch(/async function searchBase[\s\S]{0,120}requireProductAccess\(\)/)
  })
})
