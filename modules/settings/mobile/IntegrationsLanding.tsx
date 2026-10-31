'use client'

import { useEffect, useState } from 'react'
import { INTEGRATIONS } from '@/components/settings/integrations/catalog'
import { MetaLeadAdsBadge, WhatsappBadge } from '@/components/ui/MetaLeadAdsBadge'
import Icon from '@/lib/Icon'
import { useRegionAttrs, useT } from '@/lib/i18n/I18nProvider'
import type { FacebookHealthStatus } from '@/lib/facebook/health'
import type { WhatsappHealthPrimary } from '@/lib/whatsapp/operationalStatus'
import DriveCardMobile from './DriveCardMobile'
import IntegrationsSheets from './IntegrationsSheets'
import IntegrationCardMobile from './IntegrationCardMobile'
import { calendarLandingCopy, facebookLandingCopy, readyMessagesLandingCopy, whatsappLandingCopy } from './integrationStatus'
import { calendarReturnCopy, facebookReturnCopy, whatsappReturnCopy, type OAuthReturnQuery } from './oauthReturn'
import { useIntegrationReturnContinuation } from './useIntegrationReturn'
import type { InAppBrowser } from '@/lib/connections/useInAppWarning'

export type IntegrationsLandingProps = {
  initialSheet: 'whatsapp' | 'facebook' | 'calendar' | 'drive' | null
  oauthQuery?: OAuthReturnQuery
  /** Server-detected Instagram/Facebook in-app browser, forwarded to both connect flows. */
  inAppBrowser?: InAppBrowser
  whatsapp: {
    connection: { phoneNumberId: string } | null
    pendingPhones: { id: string; displayPhone: string; verifiedName: string }[] | null
    appId: string
    configId: string
    graphVersion: string
    status: WhatsappHealthPrimary
  }
  facebook: {
    connection: { pageId: string; pageName: string } | null
    pendingPages: { id: string; name: string }[] | null
    health: FacebookHealthStatus | null
  }
  templates: {
    enabled: boolean
    connected: boolean
    messagingReady: boolean
    total: number
    approved: number
    pending: number
  }
  calendar: {
    state: 'not_connected' | 'connected' | 'reauth_required'
    email: string | null
    lastError: string | null
  }
  websiteVisible: boolean
}

export type Sheet = 'whatsapp' | 'facebook' | 'calendar' | 'drive' | null

/**
 * Phone Integrations landing — status cards, not the desktop accordion.
 *
 * Connect / disconnect still run through WhatsappConnect, FacebookConnect,
 * CalendarConnect and IntegrationCard. This file only decides what the owner
 * sees first and which sheet opens.
 */
export default function IntegrationsLanding({
  initialSheet,
  oauthQuery = {},
  inAppBrowser,
  whatsapp,
  facebook,
  templates,
  calendar,
  websiteVisible,
}: IntegrationsLandingProps) {
  const t = useT()
  const region = useRegionAttrs()
  const locale = t.locale
  const [sheet, setSheet] = useState<Sheet>(initialSheet)
  const { facebookCompleting, whatsappCompleting } = useIntegrationReturnContinuation({
    facebookConnected: !!facebook.connection,
    pendingPages: facebook.pendingPages,
    whatsappConnected: !!whatsapp.connection,
    pendingPhones: whatsapp.pendingPhones,
    calendarConnecting: oauthQuery.gcal === 'connected',
    calendarConnected: calendar.state === 'connected',
  })

  useEffect(() => {
    setSheet(initialSheet)
  }, [initialSheet])

  const waCopy = whatsapp.connection
    ? whatsappLandingCopy({ connected: true, status: whatsapp.status }, locale)
    : (whatsappReturnCopy({
        pendingPhones: whatsapp.pendingPhones,
        error: oauthQuery.wa_error ?? null,
        completing: whatsappCompleting,
      }, locale) ?? whatsappLandingCopy({ connected: false, status: whatsapp.status }, locale))

  const fbCopy = facebook.connection
    ? facebookLandingCopy({ connection: facebook.connection, health: facebook.health }, locale)
    : (facebookReturnCopy({
        pendingPages: facebook.pendingPages,
        error: oauthQuery.error ?? null,
        select: oauthQuery.select === '1',
        completing: facebookCompleting,
      }, locale) ?? facebookLandingCopy({ connection: null, health: facebook.health }, locale))

  const rmCopy = readyMessagesLandingCopy(templates, locale)
  const calCopy =
    calendarReturnCopy({
      connected: calendar.state === 'connected',
      error: oauthQuery.gcal_error ?? null,
      connecting: oauthQuery.gcal === 'connected' && calendar.state !== 'connected',
    }, locale) ?? calendarLandingCopy({ state: calendar.state, email: calendar.email }, locale)
  const drive = INTEGRATIONS.find((i) => i.id === 'google-drive')

  const rmHref = !templates.connected || !templates.messagingReady ? undefined : '/settings/integrations?section=templates'
  const rmOpensWhatsapp = !templates.connected || !templates.messagingReady

  return (
    <div data-testid='integrations-mobile' className='px-4 pb-8 pt-4' {...region}>
      <header className='mb-5'>
        <h1 className='text-xl font-bold leading-tight text-ink'>{t('settings.account.title.integrations')}</h1>
        <p className='mt-1.5 text-sm leading-relaxed text-gray-500'>{t('settings.mobile.landing.intro')}</p>
      </header>

      <section className='flex flex-col gap-3' aria-label={t('settings.integrations.sources.title')}>
        <h2 className='text-sm font-semibold text-gray-500'>{t('settings.integrations.sources.title')}</h2>

        <IntegrationCardMobile
          title={t('settings.integrations.section.whatsapp')}
          leading={<WhatsappBadge size='sm' />}
          statusLabel={waCopy.statusLabel}
          explanation={waCopy.explanation}
          actionLabel={waCopy.actionLabel}
          role={waCopy.role}
          actionDisabled={whatsappCompleting}
          onAction={() => setSheet('whatsapp')}
        />

        <IntegrationCardMobile
          title={t('settings.mobile.landing.meta')}
          leading={<MetaLeadAdsBadge size='sm' />}
          statusLabel={fbCopy.statusLabel}
          explanation={fbCopy.explanation}
          actionLabel={fbCopy.actionLabel}
          role={fbCopy.role}
          actionDisabled={facebookCompleting}
          onAction={() => setSheet('facebook')}
        />

        {rmCopy && (
          <IntegrationCardMobile
            title={t('settings.mobile.landing.readyMessages')}
            leading={
              <span className='flex size-7 items-center justify-center rounded-lg bg-[#25D366]/15 ring-1 ring-white'>
                <Icon name='comment-dots' type='sol' className='size-3.5 bg-[#25D366]' />
              </span>
            }
            statusLabel={rmCopy.statusLabel}
            explanation={rmCopy.explanation}
            actionLabel={rmCopy.actionLabel}
            role={rmCopy.role}
            actionHref={rmHref}
            onAction={rmOpensWhatsapp ? () => setSheet('whatsapp') : undefined}
          />
        )}

        {websiteVisible && (
          <IntegrationCardMobile
            title={t('settings.integrations.section.website')}
            leading={
              <span className='flex size-7 items-center justify-center rounded-lg bg-slate-600/15 ring-1 ring-white'>
                <Icon name='globe' type='sol' className='size-3.5 bg-slate-600' />
              </span>
            }
            statusLabel={t('settings.mobile.landing.websiteStatus')}
            explanation={t('settings.mobile.landing.websiteExplain')}
            actionLabel={t('settings.mobile.landing.manage')}
            role='neutral'
            actionHref='/settings/integrations?section=website'
          />
        )}
      </section>

      <section className='mt-8 flex flex-col gap-3' aria-label={t('settings.integrations.tools.title')}>
        <h2 className='text-sm font-semibold text-gray-500'>{t('settings.integrations.tools.title')}</h2>

        <IntegrationCardMobile
          title='Google Calendar'
          leading={
            <img
              src='/media/social-icons/google-calendar-color.svg'
              alt=''
              aria-hidden='true'
              className='size-7 shrink-0 object-contain'
            />
          }
          statusLabel={calCopy.statusLabel}
          explanation={calCopy.explanation}
          actionLabel={calCopy.actionLabel}
          role={calCopy.role}
          actionDisabled={oauthQuery.gcal === 'connected' && calendar.state !== 'connected'}
          onAction={() => setSheet('calendar')}
        />

        {drive && (
          <DriveCardMobile
            integration={drive}
            onManage={() => setSheet('drive')}
            returnConnected={oauthQuery.gdrive === 'connected'}
            returnError={oauthQuery.gdrive_error ?? null}
          />
        )}
      </section>

      <IntegrationsSheets
        sheet={sheet}
        onClose={() => setSheet(null)}
        inAppBrowser={inAppBrowser}
        whatsapp={whatsapp}
        facebook={facebook}
        calendar={calendar}
        drive={drive}
        whatsappCompleting={whatsappCompleting}
        facebookCompleting={facebookCompleting}
      />
    </div>
  )
}
