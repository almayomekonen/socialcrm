'use client'

import CalendarConnect from '@/components/settings/CalendarConnect'
import FacebookConnect from '@/components/settings/FacebookConnect'
import WhatsappConnect from '@/components/settings/WhatsappConnect'
import IntegrationCard from '@/components/settings/integrations/IntegrationCard'
import type { IntegrationDescriptor } from '@/components/settings/integrations/catalog'
import type { InAppBrowser } from '@/lib/connections/useInAppWarning'
import ConnectManageSheet from './ConnectManageSheet'
import { useT } from '@/lib/i18n/I18nProvider'
import type { IntegrationsLandingProps, Sheet } from './IntegrationsLanding'

/**
 * The phone Integrations manage sheets — one per card, at most one open
 * (extracted from `IntegrationsLanding`, no behaviour change). Connect and
 * disconnect still run through the existing connect components.
 */
export default function IntegrationsSheets({
  sheet,
  onClose,
  inAppBrowser,
  whatsapp,
  facebook,
  calendar,
  drive,
  whatsappCompleting,
  facebookCompleting,
}: {
  sheet: Sheet
  onClose: () => void
  inAppBrowser?: InAppBrowser
  whatsapp: IntegrationsLandingProps['whatsapp']
  facebook: IntegrationsLandingProps['facebook']
  calendar: IntegrationsLandingProps['calendar']
  drive: IntegrationDescriptor | undefined
  whatsappCompleting: boolean
  facebookCompleting: boolean
}) {
  const t = useT()
  return (
    <>
      {/*
      MOBILE ONLY. The rep usually arrives here by tapping WhatsApp on a lead,
      so in the not-connected state the sheet names the blocker instead of the
      channel. Conditional on purpose: this is a connect AND manage sheet, and
      titling it "connection required" while a connection exists would be a lie.
      `!connection && !pendingPhones` is exactly WhatsappConnect's State A.
    */}
      <ConnectManageSheet
        open={sheet === 'whatsapp'}
        onClose={onClose}
        title={!whatsapp.connection && !whatsapp.pendingPhones ? t('settings.mobile.landing.waRequired') : t('settings.integrations.section.whatsapp')}
        titleId='wa-manage-title'
      >
        {whatsappCompleting ? (
          <p data-testid='integration-completing' className='text-sm text-gray-600'>
            {t('settings.mobile.landing.completing')}
          </p>
        ) : (
          <WhatsappConnect
            connection={whatsapp.connection}
            pendingPhones={whatsapp.pendingPhones}
            appId={whatsapp.appId}
            configId={whatsapp.configId}
            graphVersion={whatsapp.graphVersion}
            status={whatsapp.status}
            description={t('settings.mobile.landing.waDescription')}
            connectLabel={t('settings.mobile.landing.waConnect')}
            inAppBrowser={inAppBrowser}
            translated
          />
        )}
      </ConnectManageSheet>

      <ConnectManageSheet open={sheet === 'facebook'} onClose={onClose} title={t('settings.mobile.landing.meta')} titleId='fb-manage-title'>
        {facebookCompleting ? (
          <p data-testid='integration-completing' className='text-sm text-gray-600'>
            {t('settings.mobile.landing.completing')}
          </p>
        ) : (
          <FacebookConnect
            connection={facebook.connection}
            pendingPages={facebook.pendingPages}
            health={facebook.health}
            inAppBrowser={inAppBrowser}
            translated
          />
        )}
      </ConnectManageSheet>

      <ConnectManageSheet open={sheet === 'calendar'} onClose={onClose} title='Google Calendar' titleId='cal-manage-title'>
        <CalendarConnect state={calendar.state} email={calendar.email} lastError={calendar.lastError} translated />
      </ConnectManageSheet>

      {drive && (
        <ConnectManageSheet open={sheet === 'drive'} onClose={onClose} title={drive.name} titleId='drive-manage-title'>
          <IntegrationCard integration={drive} translated />
        </ConnectManageSheet>
      )}
    </>
  )
}
