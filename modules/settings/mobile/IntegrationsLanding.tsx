'use client'

import { useEffect, useState } from 'react'
import CalendarConnect from '@/components/settings/CalendarConnect'
import FacebookConnect from '@/components/settings/FacebookConnect'
import WhatsappConnect from '@/components/settings/WhatsappConnect'
import IntegrationCard from '@/components/settings/integrations/IntegrationCard'
import { INTEGRATIONS } from '@/components/settings/integrations/catalog'
import { MetaLeadAdsBadge, WhatsappBadge } from '@/components/ui/MetaLeadAdsBadge'
import Icon from '@/lib/Icon'
import type { FacebookHealthStatus } from '@/lib/facebook/health'
import type { WhatsappHealthPrimary } from '@/lib/whatsapp/operationalStatus'
import ConnectManageSheet from './ConnectManageSheet'
import DriveCardMobile from './DriveCardMobile'
import IntegrationCardMobile from './IntegrationCardMobile'
import {
  calendarLandingCopy,
  facebookLandingCopy,
  readyMessagesLandingCopy,
  whatsappLandingCopy,
} from './integrationStatus'
import {
  calendarReturnCopy,
  facebookReturnCopy,
  whatsappReturnCopy,
  type OAuthReturnQuery,
} from './oauthReturn'
import { useIntegrationReturnContinuation } from './useIntegrationReturn'

export type IntegrationsLandingProps = {
  initialSheet: 'whatsapp' | 'facebook' | 'calendar' | 'drive' | null
  oauthQuery?: OAuthReturnQuery
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
    pendingPages: { id: string; name: string; access_token: string }[] | null
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

type Sheet = 'whatsapp' | 'facebook' | 'calendar' | 'drive' | null

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
  whatsapp,
  facebook,
  templates,
  calendar,
  websiteVisible,
}: IntegrationsLandingProps) {
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

  const waCopy =
    whatsapp.connection
      ? whatsappLandingCopy({ connected: true, status: whatsapp.status })
      : whatsappReturnCopy({
          pendingPhones: whatsapp.pendingPhones,
          error: oauthQuery.wa_error ?? null,
          completing: whatsappCompleting,
        }) ?? whatsappLandingCopy({ connected: false, status: whatsapp.status })

  const fbCopy =
    facebook.connection
      ? facebookLandingCopy({ connection: facebook.connection, health: facebook.health })
      : facebookReturnCopy({
          pendingPages: facebook.pendingPages,
          error: oauthQuery.error ?? null,
          select: oauthQuery.select === '1',
          completing: facebookCompleting,
        }) ?? facebookLandingCopy({ connection: null, health: facebook.health })

  const rmCopy = readyMessagesLandingCopy(templates)
  const calCopy =
    calendarReturnCopy({
      connected: calendar.state === 'connected',
      error: oauthQuery.gcal_error ?? null,
      connecting: oauthQuery.gcal === 'connected' && calendar.state !== 'connected',
    }) ?? calendarLandingCopy({ state: calendar.state, email: calendar.email })
  const drive = INTEGRATIONS.find((i) => i.id === 'google-drive')

  const rmHref =
    !templates.connected || !templates.messagingReady
      ? undefined
      : '/settings/integrations?section=templates'
  const rmOpensWhatsapp = !templates.connected || !templates.messagingReady

  return (
    <div data-testid='integrations-mobile' className='px-4 pb-8 pt-4'>
      <header className='mb-5'>
        <h1 className='text-xl font-bold leading-tight text-ink'>אינטגרציות</h1>
        <p className='mt-1.5 text-sm leading-relaxed text-gray-500'>
          מה מחובר, מה לא, ומה הצעד הבא — במקום אחד.
        </p>
      </header>

      <section className='flex flex-col gap-3' aria-label='מקורות לידים'>
        <h2 className='text-sm font-semibold text-gray-500'>מקורות לידים</h2>

        <IntegrationCardMobile
          title='וואטסאפ'
          leading={<WhatsappBadge size='sm' />}
          statusLabel={waCopy.statusLabel}
          explanation={waCopy.explanation}
          actionLabel={waCopy.actionLabel}
          role={waCopy.role}
          actionDisabled={whatsappCompleting}
          onAction={() => setSheet('whatsapp')}
        />

        <IntegrationCardMobile
          title='פייסבוק ואינסטגרם'
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
            title='הודעות מוכנות'
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
            title='האתר שלי'
            leading={
              <span className='flex size-7 items-center justify-center rounded-lg bg-slate-600/15 ring-1 ring-white'>
                <Icon name='globe' type='sol' className='size-3.5 bg-slate-600' />
              </span>
            }
            statusLabel='טפסי האתר'
            explanation='חברו את הטפסים באתר כדי שכל פנייה תיכנס כליד.'
            actionLabel='ניהול'
            role='neutral'
            actionHref='/settings/integrations?section=website'
          />
        )}
      </section>

      <section className='mt-8 flex flex-col gap-3' aria-label='כלים מחוברים'>
        <h2 className='text-sm font-semibold text-gray-500'>כלים מחוברים</h2>

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

      {/*
        MOBILE ONLY. The rep usually arrives here by tapping WhatsApp on a lead,
        so in the not-connected state the sheet names the blocker instead of the
        channel. Conditional on purpose: this is a connect AND manage sheet, and
        titling it "connection required" while a connection exists would be a lie.
        `!connection && !pendingPhones` is exactly WhatsappConnect's State A.
      */}
      <ConnectManageSheet
        open={sheet === 'whatsapp'}
        onClose={() => setSheet(null)}
        title={!whatsapp.connection && !whatsapp.pendingPhones ? 'חיבור WhatsApp נדרש' : 'וואטסאפ'}
        titleId='wa-manage-title'
      >
        {whatsappCompleting ? (
          <p data-testid='integration-completing' className='text-sm text-gray-600'>
            משלים חיבור...
          </p>
        ) : (
          <WhatsappConnect
            connection={whatsapp.connection}
            pendingPhones={whatsapp.pendingPhones}
            appId={whatsapp.appId}
            configId={whatsapp.configId}
            graphVersion={whatsapp.graphVersion}
            status={whatsapp.status}
            description='כדי לשלוח הודעות ללידים ישירות מ־SocialCRM, חבר את ה־WhatsApp העסקי שלך.'
            connectLabel='חבר WhatsApp עסקי'
          />
        )}
      </ConnectManageSheet>

      <ConnectManageSheet
        open={sheet === 'facebook'}
        onClose={() => setSheet(null)}
        title='פייסבוק ואינסטגרם'
        titleId='fb-manage-title'
      >
        {facebookCompleting ? (
          <p data-testid='integration-completing' className='text-sm text-gray-600'>
            משלים חיבור...
          </p>
        ) : (
          <FacebookConnect
            connection={facebook.connection}
            pendingPages={facebook.pendingPages}
            health={facebook.health}
          />
        )}
      </ConnectManageSheet>

      <ConnectManageSheet
        open={sheet === 'calendar'}
        onClose={() => setSheet(null)}
        title='Google Calendar'
        titleId='cal-manage-title'
      >
        <CalendarConnect state={calendar.state} email={calendar.email} lastError={calendar.lastError} />
      </ConnectManageSheet>

      {drive && (
        <ConnectManageSheet
          open={sheet === 'drive'}
          onClose={() => setSheet(null)}
          title={drive.name}
          titleId='drive-manage-title'
        >
          <IntegrationCard integration={drive} />
        </ConnectManageSheet>
      )}
    </div>
  )
}
