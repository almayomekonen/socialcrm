import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isMobileWorkspaceRequest } from '@/lib/device'
import { ProductAccessError, requireAgencyUser } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { canUseQuestionnaireBuilder, canUseQuestionnaireFlowEditor } from '@/lib/flags/questionnaireBuilderFlags'
import { canUseQuestionnaireNaturalAnswers } from '@/lib/flags/whatsappQuestionnaireFlags'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { authorizeBuilder } from '@/lib/inbox/autoresponse/questionnaire/builder/authorize'
import { getBuilderState } from '@/lib/inbox/autoresponse/questionnaire/builder/service'
import QuestionnaireBuilder from '@/components/settings/questionnaire/QuestionnaireBuilder'
import QuestionnaireMobile from '@/components/settings/questionnaire/QuestionnaireMobile'
import { getServerT, getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await requireAgencyUser())
  return { title: t('admin.questionnaire.title') }
}

/**
 * The Questionnaire Builder.
 *
 * ONE GATE: `authorizeBuilder` (PR1) — product access, an admin role, and the
 * agency in QUESTIONNAIRE_BUILDER_AGENCY_IDS. Anyone else gets a 404, exactly as
 * if the page did not exist; no nav item or link points here for them either.
 *
 * Rendering reads only. The draft is opened (created when there is none) by the
 * editor through the PR1 action, a POST, so a prefetch or a crawler can never
 * create one.
 *
 * Phones get the reduced view (status + test), decided on the server before any
 * desktop work (architecture-rules §9). Editing is desk work.
 */
export default async function QuestionnaireBuilderPage() {
  // Outside the rollout the page does not exist, whatever the subscription says.
  const user = await requireAgencyUser()
  if (!isAdmin(user.role) || !canUseQuestionnaireBuilder(user.agencyId)) notFound()
  const { locale } = await getUiLocaleState(user)

  let ctx: Awaited<ReturnType<typeof authorizeBuilder>>
  try {
    ctx = await authorizeBuilder()
  } catch (error) {
    // An expired subscription: say so, the way מענה אוטומטי does, never a crash.
    if (!(error instanceof ProductAccessError)) throw error
    return (
      <div className='max-w-2xl' {...regionAttrs(locale)}>
        <SubscriptionExpiredState mode='inline' source='questionnaire_builder' feature={translatorFor(locale)('admin.questionnaire.expiredFeature')} translated />
      </div>
    )
  }
  if (!ctx) notFound()

  const state = await getBuilderState(ctx)
  const routing = {
    routedToQuestionnaire: state.live.routedToQuestionnaire,
    channelEnabled: state.live.channelEnabled,
    masterEnabled: state.live.masterEnabled,
  }

  if (await isMobileWorkspaceRequest(ctx.agencyId)) {
    return (
      <QuestionnaireMobile
        liveRevision={state.published?.revision ?? null}
        published={state.published?.questionnaire ?? null}
        hasDraft={state.draft !== null}
        routing={routing}
      />
    )
  }

  // The Flow view (תרשים / רשימה): only agencies listed in
  // QUESTIONNAIRE_FLOW_EDITOR_AGENCY_IDS, decided here from the authorised
  // agency, never by the client. Otherwise only the list view exists. Shared
  // Builder improvements (icon chooser, phrase teaching in the test chat) apply
  // to the list view either way.
  const flowEnabled = canUseQuestionnaireFlowEditor(ctx.agencyId)
  // "לקוח יכול לענות 'הכל'" only where natural-answer reading is on for this
  // agency: elsewhere the switch would do nothing.
  const allowAllEnabled = canUseQuestionnaireNaturalAnswers(ctx.agencyId)
  return (
    <QuestionnaireBuilder
      initialDraft={state.draft}
      liveRevision={state.published?.revision ?? null}
      routing={routing}
      flowEnabled={flowEnabled}
      allowAllEnabled={allowAllEnabled}
    />
  )
}
