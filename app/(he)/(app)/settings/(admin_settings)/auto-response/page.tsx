import type { Metadata } from 'next'
import { requireAgencyUser } from '@/lib/requireUser'
import { db } from '@/config/db'
import { getAgencyProductAccess } from '@/lib/access/productAccess'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { isMobileWorkspaceRequest } from '@/lib/device'
import { getMasterEnabled, getChannelSettings, getAgentProfile } from '@/db/autoResponseSettings'
import { canUseConversationalAgent } from '@/lib/flags/conversationalAgentFlags'
import AutoResponseSettingsForm from '@/components/settings/autoResponse/AutoResponseSettingsForm'
import { resolveResponderChoice } from '@/lib/inbox/autoresponse/responderChoice'
import { aiConversational, storedMethod } from '@/lib/inbox/autoresponse/responseMethod'
import { canUseSmartReplyAgent } from '@/lib/flags/smartReplyAgentFlags'
import { canUseWhatsappQuestionnaire } from '@/lib/flags/whatsappQuestionnaireFlags'
import { parseQuestionnaireDefinition } from '@/lib/inbox/autoresponse/questionnaire/definition'
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
    // The layout's request-memoised read: the phone screen is worded in it.
    const { locale: mobileLocale } = await getUiLocaleState(user)
    return <AutoResponseMobile agencyId={user.agencyId} role={user.role} locale={mobileLocale} />
  }


  /*
   * TIER 2. The page stays readable: an expired customer can still see what
   * they built and what the product does for them. Only the actions that spend
   * money stay gated, each at its own control, so this surface teaches value
   * instead of turning into a wall.
   */
  const proLocked = !(await getAgencyProductAccess(user.agencyId)).hasAccess
  const { locale } = await getUiLocaleState(user)

  // The agent-profile section exists only for an agency on the conversational agent.
  const conversational = canUseConversationalAgent(user.agencyId)
  const [master, channel, agency, agentProfile] = await Promise.all([
    getMasterEnabled(user.agencyId),
    getChannelSettings(user.agencyId, 'whatsapp'),
    db('agencies').where({ id: user.agencyId }).first('name'),
    conversational ? getAgentProfile(user.agencyId, 'whatsapp') : Promise.resolve(undefined),
  ])

  // The persisted method and what this agency can actually run (one rule,
  // shared with the save action). Never inferred from replyMode alone.
  const choice = channel ? resolveResponderChoice({
    responder: channel.responder,
    mode: channel.mode,
    replyMode: channel.replyMode,
    questionnaireAllowed: canUseWhatsappQuestionnaire(user.agencyId),
    questionnairePublished: parseQuestionnaireDefinition(channel.questionnaire ?? null).ok,
  }) : null
  const builderHref = canUseQuestionnaireBuilder(user.agencyId) ? '/settings/questionnaire' : undefined

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
        {...(conversational ? { agentProfile: agentProfile ?? null } : {})}
        method={{
          stored: storedMethod(choice, channel?.replyMode),
          questionnaire: choice ? choice.questionnaire : null,
          aiConversational: aiConversational(channel?.mode, canUseSmartReplyAgent(user.agencyId)),
          stalled: choice?.questionnaireStalled ?? false,
          ...(builderHref ? { builderHref } : {}),
        }}
      />
    </>
  )
}
