import type { ReactNode } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import type { Allowance } from './leakScan'
import type { Surface } from './surfaces'
import { DETAIL, LIST_ROWS, NOW, PHONE_CUSTOMER_DATA, SOURCE_DETAILS } from './phoneLeadsEnv'
import { phoneShell, resolveServer } from './phoneLeadsHarness'
import { DETAIL_EXTERNAL } from './leadDetailEnv'

/**
 * Leak-gate registrations for the phone lead screens (i18n Phase F2). Spread
 * into SURFACES (surfaces.tsx). The components are rendered with fixture
 * props inside the phone providers (the gate's device mock answers "desktop"
 * for the pages). The sheets are portalled into <body>, outside the gate's
 * container, so they are scanned where they are opened: phoneLeadsLocales.test.tsx
 * (`noLeaks`). The pages' wiring is covered there too.
 */

function data(...texts: string[]): Allowance[] {
  return texts.map((text) => {
    if (PHONE_CUSTOMER_DATA.includes(text)) return { text, reason: 'customer-data' as const }
    if (DETAIL_EXTERNAL.includes(text)) return { text, reason: 'external' as const }
    throw new Error(`not declared as fixture data: ${text}`)
  })
}

const wrap = (locale: UiLocale, node: ReactNode) => phoneShell(locale, node)

export const PHONE_LEADS_SURFACES: Surface[] = [
  {
    name: 'phone lead list — every card shape, filters active, more to load, the header "+"',
    route: '/leads (phone)',
    render: async (locale) => {
      const { default: LeadListMobile } = await import('@/modules/leads/mobile/LeadListMobile')
      return wrap(
        locale,
        <LeadListMobile rows={structuredClone(LIST_ROWS) as never} filters={{ q: 'יוסי', status: ['new', 'contacted'] }} hasMore page={1} workspaceEmpty={false} nowMs={NOW} whatsappConnected locale={locale} />,
      )
    },
    allowed: [...data(...LIST_ROWS.map((r) => r.name)), { text: 'יוסי', reason: 'customer-data' }],
  },
  {
    name: 'phone lead list — filtered empty (search)',
    route: '/leads?q= (phone)',
    render: async (locale) => {
      const { default: LeadListMobile } = await import('@/modules/leads/mobile/LeadListMobile')
      return wrap(locale, <LeadListMobile rows={[]} filters={{ q: 'zzz', status: [] }} hasMore={false} page={1} workspaceEmpty={false} nowMs={NOW} locale={locale} />)
    },
    allowed: [],
  },
  {
    name: 'phone lead detail — status, follow-up, contact, provenance (Facebook + answers), AI card chrome, first-lead guidance',
    route: '/clients/[id]/summary (phone)',
    render: async (locale) => {
      const { default: LeadDetailMobile } = await import('@/modules/leads/mobile/LeadDetailMobile')
      const lead = { ...DETAIL, ...SOURCE_DETAILS.facebook, nextFollowUpAt: null }
      const node = await resolveServer(<LeadDetailMobile lead={lead as never} nowMs={NOW} firstLead whatsappConnected locale={locale} />, new Set([LeadDetailMobile]))
      return wrap(locale, node)
    },
    allowed: data(DETAIL.name, DETAIL.followUpNote as string, 'חיפה', 'מה התקציב שלך?', 'עד 5,000', ...DETAIL_EXTERNAL.slice(-5)),
  },
  {
    name: 'phone lead detail — WhatsApp provenance with its conversation',
    route: '/clients/[id]/summary (phone, WhatsApp lead)',
    render: async (locale) => {
      const { default: LeadDetailMobile } = await import('@/modules/leads/mobile/LeadDetailMobile')
      const lead = { ...DETAIL, ...SOURCE_DETAILS.whatsapp }
      const node = await resolveServer(<LeadDetailMobile lead={lead as never} nowMs={NOW} locale={locale} />, new Set([LeadDetailMobile]))
      return wrap(locale, node)
    },
    allowed: data(DETAIL.name, DETAIL.followUpNote as string, DETAIL_EXTERNAL[3], ...DETAIL_EXTERNAL.slice(-5)),
  },
]
