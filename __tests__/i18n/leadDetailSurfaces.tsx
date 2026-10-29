import type { Surface } from './surfaces'
import type { Allowance } from './leakScan'
import { ATTRIBUTION, DETAIL_CUSTOMER_DATA, DETAIL_EXTERNAL, EXPIRED, FAMILY, SUMMARY_LEAD, TASKS } from './leadDetailEnv'
import { detailLayout, detailShell, summaryPage, withDetailEnv } from './leadDetailHarness'

/**
 * Leak-gate registrations for the lead DETAIL screen (Phase C):
 * /clients/[clientId] layout + summary, desktop. Spread into SURFACES
 * (surfaces.tsx); rendering relies on the mocks in leakGate.test.tsx.
 */

/** A lead-detail allowance: only declared fixture data (customer or third-party) may be allowed. */
function detailData(...texts: string[]): Allowance[] {
  return texts.map((text) => {
    if (DETAIL_CUSTOMER_DATA.includes(text)) return { text, reason: 'customer-data' as const }
    if (DETAIL_EXTERNAL.includes(text)) return { text, reason: 'external' as const }
    throw new Error(`not declared as lead-detail fixture data: ${text}`)
  })
}

const NOTE = SUMMARY_LEAD.followUpNote
const TASK_TITLES = TASKS.map((t) => t.title)
/** The AI's own text (decision D3: never translated). */
const AI_TEXT = DETAIL_EXTERNAL.filter((t) => !['חיפה', 'מה התקציב שלך?', 'עד 5,000'].includes(t)).slice(-5)

export const LEAD_DETAIL_SURFACES: Surface[] = [
  {
    name: 'lead detail — header + tab nav (handler, family, birth date, gender)',
    route: '/clients/[clientId]',
    render: async (locale) => {
      const tree = await withDetailEnv({ family: FAMILY }, () => detailLayout())
      return detailShell(locale, tree)
    },
    allowed: detailData('יוסי לוי', 'רחל לוי', 'מנהל ראשי'),
  },
  {
    name: 'lead summary — manual lead: status, follow-up + note, last outcome, ready message, intelligence, tasks, activity',
    route: '/clients/[clientId]/summary',
    render: async (locale) => detailShell(locale, await withDetailEnv({}, () => summaryPage())),
    allowed: detailData(NOTE, ...TASK_TITLES, ...AI_TEXT),
  },
  {
    name: 'lead summary — Meta Lead Ads lead: form answers, ad attribution, intelligence error',
    route: '/clients/[clientId]/summary',
    render: async (locale) => {
      const page = await withDetailEnv(
        {
          lead: { ...SUMMARY_LEAD, leadSource: 'facebook:1234567890', followUpNote: null, nextFollowUpAt: null, lastOutcomeType: null },
          attribution: ATTRIBUTION,
          tasks: [],
          intelligence: { ok: false, reason: 'provider-error' },
        },
        () => summaryPage(),
      )
      return detailShell(locale, page)
    },
    allowed: detailData('חיפה', 'מה התקציב שלך?', 'עד 5,000', ATTRIBUTION.campaignName, ATTRIBUTION.adsetName, ATTRIBUTION.adName),
  },
  {
    name: 'lead summary — WhatsApp inbound lead, first-lead callout, organic attribution',
    route: '/clients/[clientId]/summary',
    render: async (locale) => {
      const { beginFirstLeadFlow } = await import('@/components/clients/firstLeadFlow')
      beginFirstLeadFlow(43)
      const page = await withDetailEnv(
        {
          lead: { ...SUMMARY_LEAD, leadSource: 'whatsapp:972501234567', followUpNote: null, nextFollowUpAt: null, lastOutcomeType: null },
          attribution: { ...ATTRIBUTION, campaignName: null, adsetName: null, adName: null, platform: 'fb', isOrganic: true },
          tasks: [],
          intelligence: { ok: false, reason: 'disabled' },
        },
        () => summaryPage('43'),
      )
      return detailShell(locale, page)
    },
    allowed: detailData(DETAIL_EXTERNAL.find((t) => t.startsWith('היי'))!),
  },
  {
    name: 'lead summary — expired subscription: follow-up locked, intelligence teaser',
    route: '/clients/[clientId]/summary',
    render: async (locale) => {
      const page = await withDetailEnv({ hasAccess: false }, () => summaryPage())
      return detailShell(locale, page, EXPIRED)
    },
    allowed: detailData(NOTE, ...TASK_TITLES),
  },
  {
    name: 'lead detail — not found, intelligence skeleton',
    route: '/clients/[clientId]',
    render: async (locale) => {
      const notFound = await withDetailEnv({ header: null, lead: null }, () => detailLayout())
      const { default: Skeleton } = await import('@/components/ai/LeadIntelligenceCardSkeleton')
      return detailShell(
        locale,
        <>
          {notFound}
          <Skeleton locale={locale} />
        </>,
      )
    },
    allowed: [],
  },
]
