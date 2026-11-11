'use client'

import OnboardingActionCard from '@/components/clients/OnboardingActionCard'
import { useRegionAttrs, useT } from '@/lib/i18n/I18nProvider'
import type { ResponderChoice, ResponderKind } from '@/lib/inbox/autoresponse/responderChoice'

type Props = {
  /**
   * Null when the agency has no auto_response_settings row yet. Nothing then
   * answers on WhatsApp, both cards are shown unavailable, and the screen says
   * the first setup is done from a computer.
   */
  choice: ResponderChoice | null
}

// Spelled out (no template keys) so translation coverage can see every key.
const CURRENT_KEY = {
  agent: 'admin.autoResponse.responder.current.agent',
  questionnaire: 'admin.autoResponse.responder.current.questionnaire',
  one_ai_reply: 'admin.autoResponse.responder.current.one_ai_reply',
  one_fixed_reply: 'admin.autoResponse.responder.current.one_fixed_reply',
} as const
const REASON_KEY = {
  agent_not_conversational: 'admin.autoResponse.responder.reason.agent_not_conversational',
  questionnaire_not_published: 'admin.autoResponse.responder.reason.questionnaire_not_published',
  questionnaire_not_enabled: 'admin.autoResponse.responder.reason.questionnaire_not_enabled',
} as const

/**
 * READ ONLY — the phone's "which method answers" block (AutoResponseMobile).
 *
 * The cards render the PERSISTED choice computed on the server
 * (resolveResponderChoice). Nothing here switches anything: the method is
 * changed only on the desktop form (ResponseMethodSelector), whose save writes
 * responder, replyMode and mode together. The old instant switch, which wrote
 * `responder` alone, was removed with it. Keep this component only while the
 * phone screen renders it.
 */
export default function ResponderSelector({ choice }: Props) {
  const t = useT()
  const region = useRegionAttrs()

  function card(kind: ResponderKind) {
    const title = t(kind === 'agent' ? 'admin.autoResponse.responder.agentTitle' : 'admin.autoResponse.responder.questionnaireTitle')
    const description = t(kind === 'agent' ? 'admin.autoResponse.responder.agentBody' : 'admin.autoResponse.responder.questionnaireBody')
    const icon = kind === 'agent' ? 'sparkles' : 'list-check'

    if (!choice) {
      return (
        <div key={kind} className='flex flex-col gap-2' data-responder-option={kind}>
          <OnboardingActionCard icon={icon} tileClass='bg-gray-400' title={title} description={description} fullDescription disabled className='h-full' />
        </div>
      )
    }

    const option = choice[kind]
    const isActive = choice.active === kind
    const unavailable = !isActive && !option.available
    return (
      <div key={kind} className='flex flex-col gap-2' data-responder-option={kind}>
        {/* The active card keeps its selected look; every other card is inert. */}
        <OnboardingActionCard
          icon={icon}
          tileClass={unavailable ? 'bg-gray-400' : 'bg-primary'}
          title={title}
          description={description}
          fullDescription
          badge={isActive ? t('admin.autoResponse.responder.active') : unavailable ? t('admin.autoResponse.responder.unavailable') : undefined}
          badgeClass={isActive ? 'bg-primary text-white' : undefined}
          selected={isActive}
          disabled={!isActive}
          className='h-full'
        />
        {unavailable && option.available === false && <p className='text-sm leading-relaxed text-gray-600'>{t(REASON_KEY[option.reason])}</p>}
      </div>
    )
  }

  if (!choice) {
    return (
      <section aria-labelledby='responder-heading' {...region}>
        <h2 id='responder-heading' className='text-base font-semibold text-ink'>
          {t('admin.autoResponse.responder.heading')}
        </h2>
        <p className='mt-1.5 text-sm leading-relaxed text-gray-800' role='status' data-responder-current='no_settings'>
          {t('admin.autoResponse.responder.noSettingsMobile')}
        </p>
        <div className='mt-4 grid gap-3 md:grid-cols-2'>
          {card('agent')}
          {card('questionnaire')}
        </div>
      </section>
    )
  }

  return (
    <section aria-labelledby='responder-heading' {...region}>
      <h2 id='responder-heading' className='text-base font-semibold text-ink'>
        {t('admin.autoResponse.responder.heading')}
      </h2>
      <p className='mt-1.5 text-sm leading-relaxed text-gray-600'>{t('admin.autoResponse.responder.mobileHint')}</p>

      <div className='mt-4 grid gap-3 md:grid-cols-2'>
        {card('agent')}
        {card('questionnaire')}
      </div>

      {/*
        The active card's "פעיל" badge already says what answers. The line
        stays only when no card is active (one AI reply / one fixed reply),
        where it is the only explanation of what customers receive.
      */}
      {choice.active === null && (
        <p className='mt-4 text-sm font-medium text-gray-800' role='status' data-responder-current={choice.current}>
          {t(CURRENT_KEY[choice.current])}
        </p>
      )}
      {choice.questionnaireStalled && (
        <p className='mt-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-gray-800'>
          {t('admin.autoResponse.responder.stalled')}{' '}
          {choice.questionnaire.available === false && t(REASON_KEY[choice.questionnaire.reason])}
        </p>
      )}
    </section>
  )
}
