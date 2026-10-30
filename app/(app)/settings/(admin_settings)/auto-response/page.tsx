import type { Metadata } from 'next'
import { requireAgencyUser } from '@/lib/requireUser'
import { db } from '@/config/db'
import { getAgencyProductAccess } from '@/lib/access/productAccess'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { isMobileWorkspaceRequest } from '@/lib/device'
import { getMasterEnabled, getChannelSettings } from '@/db/autoResponseSettings'
import AutoResponseSettingsForm from '@/components/settings/autoResponse/AutoResponseSettingsForm'
import QuestionnaireModeNotice from '@/components/settings/autoResponse/QuestionnaireModeNotice'
import AutoResponseMobile from '@/modules/settings/mobile/AutoResponseMobile'
import { canUseQuestionnaireBuilder } from '@/lib/flags/questionnaireBuilderFlags'
import { getServerT, getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await requireAgencyUser())
  return { title: t('admin.autoResponse.title') }
}

export default async function AutoResponseSettingsPage() {
  const user = await requireAgencyUser()

  /**
   * MOBILE מענה אוטומטי. The desktop form below is a seven-field configuration
   * screen — daily cap, delay, guidance, reply mode, fixed body, channel and
   * master. On a phone that is desk work, so the mobile branch renders status,
   * the configured message read-only, and the one control that is genuinely
   * urgent away from a computer: the master kill switch.
   *
   * Returned BEFORE the desktop's parallel reads, so a phone does no wasted
   * work and receives no desktop markup (architecture-rules.md §9). The desktop
   * path below is unchanged.
   */
  if (await isMobileWorkspaceRequest(user.agencyId)) {
    return <AutoResponseMobile agencyId={user.agencyId} role={user.role} />
  }


  /*
   * TIER 2. The page stays readable: an expired customer can still see what
   * they built and what the product does for them. Only the actions that spend
   * money stay gated, each at its own control, so this surface teaches value
   * instead of turning into a wall.
   */
  const proLocked = !(await getAgencyProductAccess(user.agencyId)).hasAccess
  const { locale } = await getUiLocaleState(user)

  const [master, channel, agency] = await Promise.all([
    getMasterEnabled(user.agencyId),
    getChannelSettings(user.agencyId, 'whatsapp'),
    db('agencies').where({ id: user.agencyId }).first('name'),
  ])

  return (
    <>
      {proLocked && (
        <div className='mb-6 max-w-2xl' {...regionAttrs(locale)}>
          <SubscriptionExpiredState
            mode='inline'
            source='auto_response_settings'
            feature={translatorFor(locale)('admin.autoResponse.expiredFeature')}
            translated
          />
        </div>
      )}
      <QuestionnaireModeNotice
        active={channel?.responder === 'questionnaire'}
        builderHref={canUseQuestionnaireBuilder(user.agencyId) ? '/settings/questionnaire' : undefined}
      />
      <AutoResponseSettingsForm
        masterEnabled={master}
        channelEnabled={channel?.enabled ?? false}
        dailyCap={channel?.dailyCap ?? 200}
        guidance={channel?.guidance ?? null}
        agentInstructions={channel?.agentInstructions ?? null}
        businessName={typeof agency?.name === 'string' ? agency.name.trim() : ''}
        replyMode={channel?.replyMode ?? 'ai'}
        fixedBody={channel?.fixedBody ?? null}
        delaySeconds={channel?.delaySeconds ?? 0}
      />
    </>
  )
}
