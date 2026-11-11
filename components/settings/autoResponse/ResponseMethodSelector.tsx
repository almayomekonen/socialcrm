'use client'

import Link from 'next/link'
import OnboardingActionCard from '@/components/clients/OnboardingActionCard'
import { useT } from '@/lib/i18n/I18nProvider'
import type { OptionState } from '@/lib/inbox/autoresponse/responderChoice'
import type { ResponseMethod } from '@/lib/inbox/autoresponse/responseMethod'

/**
 * "איך עונים לפניות בוואטסאפ" — ONE choice of three: the AI, the structured
 * questionnaire, or a fixed message. It replaced two overlapping choices (AI
 * agent / questionnaire, then smart reply / fixed message).
 *
 * PART OF THE FORM. Picking a card changes the draft only; it is saved with
 * everything else from the save bar (updateAutoResponseSettings writes
 * responder, replyMode and mode together, after re-checking eligibility and that
 * the stored method is still the one shown here). So there is no confirm dialog:
 * what a switch does to conversations already in progress is said inline, under
 * the cards, while the change is still unsaved.
 *
 * TWO MARKS. The ring is the owner's current pick (the draft); the "פעיל" badge
 * is what answers customers right now (stored). They differ only while a switch
 * is unsaved.
 *
 * THE AI CARD SAYS WHAT RUNS. When the agency is (or the save will make it)
 * conversational, the card is the AI agent. Otherwise — outside the Smart Reply
 * rollout — the same choice sends ONE AI-written reply per new conversation, and
 * the card says exactly that, never "סוכן AI חכם".
 */
type Props = {
  value: ResponseMethod
  stored: ResponseMethod
  onChange: (method: ResponseMethod) => void
  /** Whether the questionnaire can run. Null: no settings row yet. */
  questionnaire: OptionState | null
  aiConversational: boolean
  /** Stored as questionnaire, but the questionnaire cannot speak. */
  stalled: boolean
  /** The Questionnaire Builder, when this agency can use it. */
  builderHref?: string
  /** Expired plan: the page stays readable, nothing can be changed. */
  locked: boolean
}

const REASON_KEY = {
  agent_not_conversational: 'admin.autoResponse.responder.reason.agent_not_conversational',
  questionnaire_not_published: 'admin.autoResponse.responder.reason.questionnaire_not_published',
  questionnaire_not_enabled: 'admin.autoResponse.responder.reason.questionnaire_not_enabled',
} as const

export default function ResponseMethodSelector({ value, stored, onChange, questionnaire, aiConversational, stalled, builderHref, locked }: Props) {
  const t = useT()
  const noSettings = questionnaire === null
  // No settings row yet: the page says to switch on and save first, so the
  // cards stay unselectable until there is a row, exactly as before.
  const frozen = locked || noSettings
  const questionnaireUnavailable = stored !== 'questionnaire' && questionnaire?.available !== true

  function pick(kind: ResponseMethod) {
    if (frozen || kind === value) return
    onChange(kind)
  }

  const badge = (kind: ResponseMethod) => (!noSettings && stored === kind ? t('admin.autoResponse.responder.active') : undefined)

  return (
    <section className='mt-8' aria-labelledby='responder-heading'>
      <h2 id='responder-heading' className='text-base font-semibold text-ink'>
        {t('admin.autoResponse.responder.heading')}
      </h2>
      <p className='mt-1.5 text-sm leading-relaxed text-gray-600'>{t('admin.autoResponse.responder.hint')}</p>

      <div className='mt-4 flex flex-col gap-3' role='group' aria-labelledby='responder-heading'>
        <div className='flex flex-col gap-2' data-responder-option='ai'>
          <OnboardingActionCard
            icon='sparkles'
            tileClass='bg-primary'
            title={t(aiConversational ? 'admin.autoResponse.responder.agentTitle' : 'admin.autoResponse.responder.oneAiTitle')}
            description={t(aiConversational ? 'admin.autoResponse.responder.agentBody' : 'admin.autoResponse.responder.oneAiBody')}
            fullDescription
            badge={badge('ai')}
            badgeClass='bg-primary text-white'
            selected={value === 'ai'}
            disabled={frozen && (noSettings || value !== 'ai')}
            onClick={() => pick('ai')}
          />
          {!aiConversational && (
            <p className='text-sm leading-relaxed text-gray-600'>{t(REASON_KEY.agent_not_conversational)}</p>
          )}
        </div>

        <div className='flex flex-col gap-2' data-responder-option='questionnaire'>
          <OnboardingActionCard
            icon='list-check'
            tileClass={questionnaireUnavailable ? 'bg-gray-400' : 'bg-primary'}
            title={t('admin.autoResponse.responder.questionnaireTitle')}
            description={t('admin.autoResponse.responder.questionnaireBody')}
            fullDescription
            badge={badge('questionnaire') ?? (questionnaireUnavailable ? t('admin.autoResponse.responder.unavailable') : undefined)}
            badgeClass={stored === 'questionnaire' && !noSettings ? 'bg-primary text-white' : undefined}
            selected={value === 'questionnaire'}
            disabled={questionnaireUnavailable || (frozen && (noSettings || value !== 'questionnaire'))}
            onClick={() => pick('questionnaire')}
          />
          {questionnaireUnavailable && questionnaire?.available === false && (
            <p className='text-sm leading-relaxed text-gray-600'>
              {t(REASON_KEY[questionnaire.reason])}
              {questionnaire.reason === 'questionnaire_not_published' && builderHref && (
                <>
                  {' '}
                  <Link href={builderHref} className='font-medium text-ink underline underline-offset-2'>
                    {t('admin.autoResponse.responder.setupLink')}
                  </Link>
                </>
              )}
            </p>
          )}
          {builderHref && !(questionnaire?.available === false && questionnaire.reason === 'questionnaire_not_published') && !noSettings && (
            <Link href={builderHref} className='w-fit text-sm font-medium text-ink underline underline-offset-2'>
              {t('admin.autoResponse.responder.editLink')}
            </Link>
          )}
        </div>

        <div className='flex flex-col gap-2' data-responder-option='fixed'>
          <OnboardingActionCard
            icon='message'
            tileClass='bg-primary'
            title={t('admin.autoResponse.style.fixed')}
            description={t('admin.autoResponse.style.fixedHint')}
            fullDescription
            badge={badge('fixed')}
            badgeClass='bg-primary text-white'
            selected={value === 'fixed'}
            disabled={frozen && (noSettings || value !== 'fixed')}
            onClick={() => pick('fixed')}
          />
        </div>
      </div>

      {noSettings && (
        <p className='mt-4 text-sm leading-relaxed text-gray-800' role='status' data-responder-current='no_settings'>
          {t('admin.autoResponse.responder.noSettings')}
        </p>
      )}

      {/* What the unsaved switch will do to conversations already in progress. */}
      {value !== stored && stored === 'questionnaire' && (
        <p className='mt-4 rounded-lg border border-warning-border bg-warning-bg px-4 py-3 text-sm leading-relaxed text-gray-800' role='status' data-switch-note='leave-questionnaire'>
          {t('admin.autoResponse.responder.switchNote.leaveQuestionnaire')}
        </p>
      )}
      {value !== stored && value === 'questionnaire' && (
        <p className='mt-4 rounded-lg border border-warning-border bg-warning-bg px-4 py-3 text-sm leading-relaxed text-gray-800' role='status' data-switch-note='to-questionnaire'>
          {t('admin.autoResponse.responder.switchNote.toQuestionnaire')}
        </p>
      )}

      {stalled && value === 'questionnaire' && (
        <p className='mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-gray-800'>
          {t('admin.autoResponse.responder.stalled')}{' '}
          {questionnaire?.available === false && t(REASON_KEY[questionnaire.reason])}
        </p>
      )}
    </section>
  )
}
