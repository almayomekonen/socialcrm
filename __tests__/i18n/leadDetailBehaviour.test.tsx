// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EXPIRED, INTELLIGENCE, NOW, TEMPLATES, detailEnv, resetDetailEnv } from './leadDetailEnv'

/**
 * Behaviour of the lead detail screen under a translated UI: actions still send
 * codes and stored values, the ready-message dialog, the intelligence card's
 * Hebrew-by-default callers, the SubscriptionExpiredState language contract,
 * and producer defaults. Content/direction/hydration: leadDetailLocales.test.tsx.
 * (Mocks are repeated per file: vi.mock is hoisted per test module.)
 */

const H = vi.hoisted(() => ({
  prefs: { userLocale: 'en' as string | null },
  toasts: [] as unknown[][],
  proToasts: [] as { title: string; body: string }[],
  followUp: vi.fn(async (..._a: unknown[]) => ({})),
  clearFollowUp: vi.fn(async (..._a: unknown[]) => ({})),
  outcome: vi.fn(async (..._a: unknown[]) => ({ nextFollowUpAt: null })),
  send: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  refreshReason: 'rate-limited',
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
vi.mock('@/db/auth', async () => ({ getUser: async () => (await import('./leadDetailEnv')).DETAIL_USER }))
vi.mock('@/lib/requireUser', async () => ({ requireAgencyUser: async () => (await import('./leadDetailEnv')).DETAIL_USER }))
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: H.prefs.userLocale, agencyLocale: null }) }))
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
vi.mock('@/db/tasks', async () => ({ get5TasksByClientId: async () => (await import('./leadDetailEnv')).detailEnv.tasks }))
vi.mock('@/modules/inbox/queries', async () => {
  const { detailEnv: env } = await import('./leadDetailEnv')
  return { getInboxConversationByLeadId: async () => (env.conversationId ? { conversationId: env.conversationId } : null) }
})
vi.mock('@/db/inboxMessages', async () => ({ listConversationMessages: async () => (await import('./leadDetailEnv')).detailEnv.messages }))
vi.mock('@/db/leadFormAnswers', async () => ({ formAnswersForLead: async () => (await import('./leadDetailEnv')).detailEnv.formAnswers }))
vi.mock('@/db/adsCrmOutcomes', async () => ({ getLeadAdAttribution: async () => (await import('./leadDetailEnv')).detailEnv.attribution }))
vi.mock('@/db/adsSnapshots', async () => ({ readCreativeForAd: async () => (await import('./leadDetailEnv')).detailEnv.creative }))
vi.mock('@/lib/facebook/permissions', async () => {
  const { detailEnv: env } = await import('./leadDetailEnv')
  return { isFacebookAdsReportingEnabledForAgency: () => env.adsReporting }
})
vi.mock('@/lib/whatsapp/templates/flag', async () => {
  const { detailEnv: env } = await import('./leadDetailEnv')
  return { isTemplatesEnabledForAgency: () => env.templatesEnabled }
})
vi.mock('@/db/whatsappTemplates', async () => ({ listTemplates: async () => (await import('./leadDetailEnv')).detailEnv.templates }))
vi.mock('@/lib/inbox/whatsappOutboundTarget', async () => {
  const { detailEnv: env } = await import('./leadDetailEnv')
  return { resolveWhatsappOutboundTarget: async () => (env.reachable ? { ok: true } : { ok: false }) }
})
vi.mock('@/lib/access/productAccess', async () => {
  const { detailEnv: env } = await import('./leadDetailEnv')
  return { getAgencyProductAccess: async () => ({ hasAccess: env.hasAccess }) }
})
vi.mock('@/actions/ai/leadIntelligence', async () => ({ getLeadIntelligence: async () => (await import('./leadDetailEnv')).detailEnv.intelligence }))
vi.mock('@/actions/ai/leadIntelligenceRefresh', () => ({ refreshLeadIntelligence: async () => ({ ok: false, reason: H.refreshReason }) }))
vi.mock('@/actions/leadFollowUp', () => ({ setLeadFollowUp: H.followUp, clearLeadFollowUp: H.clearFollowUp }))
vi.mock('@/actions/leadOutcome', () => ({ logLeadOutcome: H.outcome }))
vi.mock('@/actions/whatsapp/templates/sendTemplateToLead', () => ({ sendTemplateToLead: H.send }))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: async () => {} }))
vi.mock('@/actions/analytics/recordFirstLeadEvent', () => ({ recordFirstLeadEvent: async () => {} }))
vi.mock('@/lib/toast', async () => ({
  ...(await vi.importActual<typeof import('@/lib/toast')>('@/lib/toast')),
  toast: (...args: unknown[]) => H.toasts.push(args),
  proToast: (opts: { title: string; body: string }) => H.proToasts.push(opts),
}))
vi.mock('@/components/copilot/CopilotLeadContext', () => ({ default: () => null }))
vi.mock('@/components/education/AutoTour', () => ({ default: () => null }))
vi.mock('@/components/sales/saleForm/SaleForm', () => ({ default: () => null }))
vi.mock('@/modules/leads/mobile/LeadDetailMobile', () => ({ default: () => null }))

const { detailShell, summaryPage } = await import('./leadDetailHarness')
const { __resetFirstLeadFlowForTests } = await import('@/components/clients/firstLeadFlow')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const savedEnv = { ...process.env }
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  Object.assign(process.env, { UI_LOCALE_ENABLED: '1', UI_LOCALE_AGENCY_ALLOWLIST: '103' })
})
afterAll(() => {
  vi.useRealTimers()
  process.env = { ...savedEnv }
})
afterEach(() => {
  cleanup()
  resetDetailEnv()
  __resetFirstLeadFlowForTests()
  H.toasts.length = 0
  H.proToasts.length = 0
  for (const fn of [H.followUp, H.clearFollowUp, H.outcome, H.send]) fn.mockClear()
})

type Loc = 'he' | 'en' | 'ar'
type Ent = typeof EXPIRED

async function summaryTree(locale: Loc, overrides: Partial<typeof detailEnv> = {}, ent?: Ent, clientId = '41') {
  H.prefs.userLocale = locale
  Object.assign(detailEnv, overrides)
  return detailShell(locale, await summaryPage(clientId), ent)
}

// Bidi marks Intl puts in Arabic dates (U+200E/U+200F) are dropped so assertions read plainly.
const textOf = (el: Element) => (el.textContent ?? '').replace(/[\u200e\u200f]/g, '').replace(/\s+/g, ' ')
const has = (text: string, ...parts: string[]) => {
  for (const p of parts) expect(text, p).toContain(p)
}

describe('actions send codes and stored values, never display text', () => {
  for (const locale of ['he', 'en', 'ar'] as const) {
    test(`${locale}: follow-up set/clear and outcome logging`, async () => {
      const { container } = render(await summaryTree(locale))
      const control = container.querySelector('[data-edu="lead-followup"] button')!
      fireEvent.click(control)
      await act(async () => {
        fireEvent.click(screen.getAllByRole('menuitem')[0])
      })
      expect(H.followUp).toHaveBeenCalledWith({ id: 41, at: new Date(NOW + 86_400_000).toISOString() })
      fireEvent.click(control)
      await act(async () => {
        fireEvent.click(screen.getAllByRole('menuitem').at(-1)!)
      })
      expect(H.clearFollowUp).toHaveBeenCalledWith({ id: 41 })
      const reached = { he: 'דיברנו', en: 'We talked', ar: 'تحدّثنا' }[locale]
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: reached }))
      })
      expect(H.outcome).toHaveBeenCalledWith({ id: 41, outcome: 'call_reached' })
      const toasts = H.toasts.map((t) => t[1])
      if (locale === 'en') expect(toasts.slice(0, 2)).toEqual(['Follow-up scheduled for 10/29/2026', 'Follow-up removed'])
      if (locale === 'ar') expect(toasts.slice(0, 2).map((t) => String(t).replace(/[\u200e\u200f]/g, ''))).toEqual(['تم تحديد متابعة في 29/10/2026', 'تمت إزالة المتابعة'])
    })
  }

  test('en: the follow-up menu is portalled and declares its own region', async () => {
    const { container } = render(await summaryTree('en'))
    fireEvent.click(container.querySelector('[data-edu="lead-followup"] button')!)
    const menu = document.querySelector('[role="menu"]')!
    expect(menu.closest('[data-edu]')).toBeNull()
    expect([menu.getAttribute('lang'), menu.getAttribute('dir')]).toEqual(['en', 'ltr'])
    expect(textOf(menu)).toBe('TomorrowIn 3 daysIn a weekAnother date…Remove follow-up')
  })
})

describe('ready message dialog', () => {
  test('en: chrome translated, template title and body verbatim, the send uses the template id', async () => {
    render(await summaryTree('en'))
    fireEvent.click(screen.getByRole('button', { name: 'Send a ready message' }))
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.closest('[lang]')!.getAttribute('lang')).toBe('en')
    has(textOf(dialog), 'Send a ready message', 'Choose an approved message — it will be sent to the lead on WhatsApp.', 'Preview', 'Choose a message to see a preview', 'Cancel', 'Send message', TEMPLATES[0].displayTitle, TEMPLATES[0].bodyText)
    fireEvent.click(dialog.querySelector('input[type="radio"]')!)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    })
    expect(H.send).toHaveBeenCalledWith(41, 501)
    expect(H.toasts).toContainEqual(['success', 'Message sent'])
  })

  test('en, expired: the Pro toast is translated and nothing is sent', async () => {
    render(await summaryTree('en', {}, EXPIRED))
    fireEvent.click(screen.getByRole('button', { name: 'Send a ready message' }))
    fireEvent.click(document.querySelector('[role="dialog"] input[type="radio"]')!)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    })
    expect(H.send).not.toHaveBeenCalled()
    expect(H.proToasts.at(-1)).toMatchObject({ title: 'Sending messages is available with Pro' })
  })
})

describe('intelligence card outside the translated summary stays Hebrew', () => {
  test('the inbox / mobile callers pass no locale: card, teaser and skeleton are Hebrew even under an English provider', async () => {
    const { default: Card } = await import('@/components/ai/LeadIntelligenceCard')
    const { default: Skeleton } = await import('@/components/ai/LeadIntelligenceCardSkeleton')
    const { resolveAsync } = await import('./dashboardHarness')
    const populated = render(await detailShell('en', await resolveAsync(await Card({ leadId: 41 }))))
    expect(textOf(populated.container)).toContain('תקציר חכם')
    expect(populated.container.querySelector('[lang]')).toBeNull()
    populated.unmount()
    detailEnv.hasAccess = false
    const teaser = render(await detailShell('en', await resolveAsync(await Card({ leadId: 41 }))))
    expect(screen.getByRole('button', { name: 'לצפייה בתקציר' })).toBeTruthy()
    teaser.unmount()
    const skeleton = render(await detailShell('en', <Skeleton />))
    expect(textOf(skeleton.container)).toContain('טוען תובנות חכמות עבור הליד')
  })

  test('refresh feedback follows the card locale', async () => {
    const { default: Refresh } = await import('@/components/ai/RefreshLeadIntelligenceButton')
    const { container } = render(await detailShell('en', <Refresh leadId={41} locale='en' />))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh insights' }))
    })
    expect(textOf(container)).toContain('Try again in a minute')
  })

  test('every fixed source category has a translated label', async () => {
    const { SourceCategory } = await import('@/lib/ai/prompts/leadIntelligence')
    detailEnv.intelligence = { ok: true, data: { ...INTELLIGENCE, sources: [...SourceCategory.options] } }
    const { container } = render(await summaryTree('en'))
    const line = Array.from(container.querySelectorAll('p')).find((p) => p.textContent?.startsWith('Based on:'))!
    expect(line.textContent).toBe('Based on: Lead status · Recent activity · Task history · Lead details · Lead source · Lead handling')
  })
})

describe('SubscriptionExpiredState — untranslated by default, translated on request', () => {
  async function state(locale: Loc, node: ReactNode) {
    return render(await detailShell(locale, node, EXPIRED))
  }

  test('default: Hebrew whatever the interface language, and its root re-declares Hebrew', async () => {
    const { default: S } = await import('@/components/entitlement/SubscriptionExpiredState')
    const { container } = await state('en', <S mode='panel' feature='חידוש המנוי מחזיר את ניהול השיחה' />)
    const root = container.querySelector('[data-testid="subscription-expired-state"]')!
    expect([root.getAttribute('lang'), root.getAttribute('dir')]).toEqual(['he', 'rtl'])
    const text = textOf(root)
    has(text, 'המנוי שלך הסתיים', 'חידוש המנוי מחזיר את ניהול השיחה כל הלידים', 'תוקף המנוי הסתיים בתאריך 20 באוקטובר 2026', 'חידוש מנוי')
    expect(text).not.toMatch(/[A-Za-z]/) // no English glued to the caller's Hebrew sentence
  })

  test('translated: chrome in the interface language, the caller passes its feature line translated', async () => {
    const { default: S } = await import('@/components/entitlement/SubscriptionExpiredState')
    const { container } = await state('en', <S mode='page' feature='Renewing brings back X.' translated />)
    const root = container.querySelector('[data-testid="subscription-expired-state"]')!
    expect([root.getAttribute('lang'), root.getAttribute('dir')]).toEqual(['en', 'ltr'])
    has(textOf(root), 'Your subscription has ended', 'Renewing brings back X. All your leads, conversations and history are saved', 'Your subscription ended on Oct 20, 2026', 'Renew subscription')
    expect(textOf(root)).not.toMatch(/[֐-׿]/)
  })

  test('Hebrew interface: both modes render the same markup', async () => {
    const { default: S } = await import('@/components/entitlement/SubscriptionExpiredState')
    const a = renderToString(await detailShell('he', <S mode='inline' feature='x' />, EXPIRED))
    const b = renderToString(await detailShell('he', <S mode='inline' feature='x' translated />, EXPIRED))
    expect(a).toBe(b)
    expect(a).not.toContain('lang=')
  })
})

describe('producers keep Hebrew by default', () => {
  test('outcome labels, form labels and capture time per locale', async () => {
    const { outcomeLabel, OUTCOME_LABELS } = await import('@/lib/leads/outcomeRules')
    const { formAnswerLabel } = await import('@/lib/facebook/leadFormAnswers')
    const { formatCaptureAt, facebookCapturedFieldLabels } = await import('@/lib/leads/inboundLeadContextData')
    expect(Object.keys(OUTCOME_LABELS).map((c) => outcomeLabel(c))).toEqual(Object.values(OUTCOME_LABELS))
    expect(outcomeLabel('meeting_no_show', 'en')).toBe('Missed the meeting')
    expect(outcomeLabel('custom_code', 'en')).toBe('custom_code')
    expect(formAnswerLabel('zip_code', 'en')).toBe('ZIP code')
    expect(formAnswerLabel('מה_התקציב_שלך?', 'en')).toBe('מה התקציב שלך?')
    expect(formatCaptureAt('2026-08-16T13:59:00.000Z', 'en')).toBe('8/16/2026, 04:59 PM')
    expect(facebookCapturedFieldLabels(true, false, true, 'ar')).toEqual(['الاسم', 'البريد الإلكتروني'])
  })
})

