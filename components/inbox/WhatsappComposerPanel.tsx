'use client'

import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import type { ReactNode } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import ConnectionNotice from '@/components/settings/ConnectionNotice'
import SendReadyMessage from '@/components/clients/SendReadyMessage'
import SendReadyMessageMobile from '@/components/clients/SendReadyMessageMobile'
import {
  INTEGRATIONS_SETTINGS_HREF,
  TEMPLATES_SETTINGS_HREF,
  noticeForComposerHealth,
  noticeReasonsLabel,
  resolveWhatsappComposerDecision,
  serviceWindowCopy,
} from '@/lib/inbox/whatsappComposerDecision'
import { latestInboundTimestamp, resolveWhatsappServiceWindow } from '@/lib/inbox/whatsappServiceWindow'
import type { WhatsappHealthPrimary } from '@/lib/whatsapp/operationalStatus'
import type { Template } from '@/lib/whatsapp/templates/types'
import { nativeWhatsappFallbackHref } from '@/modules/leads/contactPlan'
import { contactClicked, contactSucceeded } from '@/modules/leads/contactEvents'
import { useT } from '@/lib/i18n/I18nProvider'
import { translatorFor } from '@/lib/i18n/translators'
import type { Translator } from '@/lib/i18n/translate'

const HEBREW = translatorFor('he')

export type WhatsappComposerFacts = {
  health: WhatsappHealthPrimary
  templatesEnabled: boolean
  templates: Template[]
  canManageTemplates: boolean
  /**
   * The CUSTOMER's WhatsApp number, for the native fallback below. Optional —
   * a caller that cannot supply it gets the previous behaviour exactly.
   */
  customerWaId?: string | null
}

/**
 * NATIVE FALLBACK — the two states where WhatsApp is connected and healthy but
 * Meta leaves no in-app way to write.
 *
 *   window_unknown            the customer has never messaged this business, so
 *                             no 24h service window was ever opened. This is the
 *                             state of EVERY manually created and every imported
 *                             lead.
 *   window_closed_no_template the window closed and no approved template exists.
 *
 * Both are genuine Meta constraints on the Business API. Neither constrains the
 * rep's own phone, which is why a handoff is honest here rather than a
 * workaround: we are not bypassing a rule, we are declining to pretend that
 * Meta's API limits are the business's limits.
 *
 * A real anchor, so the first tap navigates. `lead_contact_succeeded` here means
 * the rep was handed to WhatsApp with this number — never that a message was
 * sent, delivered or answered.
 */
function NativeWhatsappFallback({ leadId, phone, t }: { leadId: number | null; phone: string | null | undefined; t: Translator }) {
  const href = nativeWhatsappFallbackHref(phone)
  if (!href || leadId == null) return null
  return (
    <a
      href={href}
      onClick={() => {
        // Intent, then terminal — both on the tap. Rendering a blocked composer
        // is NOT contact intent and emits nothing: a rep may have opened this
        // thread from the inbox with no intention of writing. Measuring blocked
        // states being VIEWED is a different question and would need its own
        // event; it is deliberately not added here.
        contactClicked(leadId, 'mobile', 'whatsapp_native')
        contactSucceeded(leadId, 'mobile', 'whatsapp_native')
      }}
      className='text-sm font-medium text-primary-text underline'
    >
      {t('inbox.serviceWindow.native')}
    </a>
  )
}

/**
 * Conversation composer shell. Window is derived from the loaded inbound
 * timestamps via the shared helper. Health + templates arrive from the server.
 */
export default function WhatsappComposerPanel({
  leadId,
  conversationId = null,
  messages,
  facts,
  textComposer,
  readyMessageSurface = 'modal',
  translated = false,
}: {
  leadId: number | null
  conversationId?: number | null
  messages: ReadonlyArray<{ direction: string; timestamp?: string | null }>
  facts: WhatsappComposerFacts
  textComposer: ReactNode
  /** Phone Inbox uses a sheet. Desktop keeps the existing middle modal. */
  readyMessageSurface?: 'modal' | 'sheet'
  /**
   * The caller's screen follows the interface language (the desktop inbox).
   * Off by default: the phone inbox is not translated yet and keeps Hebrew.
   * The ready-message picker follows the interface language on its own.
   */
  translated?: boolean
}) {
  const ui = useT()
  const t = translated ? ui : HEBREW
  const copy = serviceWindowCopy(t.locale)
  const expired = useAccessDenied()
  const window = resolveWhatsappServiceWindow(latestInboundTimestamp(messages))
  const decision = resolveWhatsappComposerDecision({
    leadId,
    health: facts.health,
    window,
    templatesEnabled: facts.templatesEnabled,
    hasApprovedTemplates: facts.templates.length > 0,
  })

  /**
   * LOCKED, NOT ABSENT.
   *
   * The audit found the reply box simply missing from an expired account's
   * conversation — no lock, no explanation, no CTA; the thread just ended, and
   * the customer had no way to tell a paused subscription from a broken product.
   * History above stays fully readable (the approved read-only policy); only the
   * ability to SEND is locked, and it says so.
   *
   * Checked before every other branch so no send affordance — text composer,
   * template picker or ready-message sheet — can render while access is lapsed.
   */
  if (expired) {
    return (
      <SubscriptionExpiredState mode='inline' source='whatsapp_composer' feature={t('inbox.locked.composer')} translated={translated} />
    )
  }

  if (decision.kind === 'leadless') return null

  if (decision.kind === 'text') return <>{textComposer}</>

  if (decision.kind === 'health_blocked') {
    const notice = noticeForComposerHealth(facts.health, t.locale)
    return (
      <div className='grid gap-2'>
        {notice ? (
          <ConnectionNotice notice={notice} reasonsLabel={noticeReasonsLabel(t.locale)} />
        ) : (
          <p className='text-sm text-gray-500'>
            {t('inbox.connect.lead')}{' '}
            <Link href={INTEGRATIONS_SETTINGS_HREF as Route} className='font-medium text-primary-text underline'>
              {t('inbox.connect.link')}
            </Link>
          </p>
        )}
        {notice && (
          <Link href={INTEGRATIONS_SETTINGS_HREF as Route} className='text-sm font-medium text-primary-text underline'>
            {t('inbox.connect.settings')}
          </Link>
        )}
      </div>
    )
  }

  if (decision.kind === 'window_unknown') {
    return (
      <div className='grid gap-2'>
        <p className='text-sm text-gray-500'>{copy.unknown}</p>
        <NativeWhatsappFallback leadId={leadId} phone={facts.customerWaId} t={t} />
      </div>
    )
  }

  if (decision.kind === 'template' && leadId != null) {
    const Picker = readyMessageSurface === 'sheet' ? SendReadyMessageMobile : SendReadyMessage
    return (
      <div className='grid gap-2'>
        <p className='text-sm font-medium text-gray-800'>{copy.closedTitle}</p>
        <p className='text-sm text-gray-500'>{copy.closedBody}</p>
        <Picker leadId={leadId} conversationId={conversationId} templates={facts.templates} lbl={copy.closedCta} />
      </div>
    )
  }

  return (
    <div className='grid gap-2'>
      <p className='text-sm text-gray-500'>{copy.closedNoTemplate}</p>
      <NativeWhatsappFallback leadId={leadId} phone={facts.customerWaId} t={t} />
      {facts.canManageTemplates && (
        <Link href={TEMPLATES_SETTINGS_HREF as Route} className='text-sm font-medium text-primary-text underline'>
          {copy.templatesSettings}
        </Link>
      )}
    </div>
  )
}
