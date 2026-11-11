'use client'

import { useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import OnboardingActionCard from '@/components/clients/OnboardingActionCard'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { toast } from '@/lib/toast'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import { useRegionAttrs, useT } from '@/lib/i18n/I18nProvider'
import { setAutoResponseResponder } from '@/actions/autoResponse/setResponder'
import type { ResponderChoice, ResponderKind } from '@/lib/inbox/autoresponse/responderChoice'

type Props = {
  /**
   * Null when the agency has no auto_response_settings row yet. Nothing then
   * answers on WhatsApp, both cards are shown unavailable, and the page says how
   * to start. No row is created and no responder is written from here.
   */
  choice: ResponderChoice | null
  /** The Questionnaire Builder, when this agency can use it. */
  builderHref?: string
  /** Phones show the state only; switching is desk work. */
  readOnly?: boolean
}

const ERROR_KEY = {
  conflict: 'admin.autoResponse.responder.error.conflict',
  unavailable: 'admin.autoResponse.responder.error.unavailable',
} as const

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
const CONFIRM_KEY = {
  agent: 'admin.autoResponse.responder.confirm.agent',
  questionnaire: 'admin.autoResponse.responder.confirm.questionnaire',
} as const
const SAVED_KEY = {
  agent: 'admin.autoResponse.responder.saved.agent',
  questionnaire: 'admin.autoResponse.responder.saved.questionnaire',
} as const

/**
 * The response method: AI conversational agent or structured questionnaire.
 *
 * The cards render the PERSISTED choice computed on the server
 * (resolveResponderChoice). Clicking the other card asks for confirmation, then
 * the server re-checks eligibility and compare-and-sets the stored value, so
 * the page never claims a switch the server refused. Only one switch can be in
 * flight: the ref closes the gap before React re-renders the disabled state.
 * The action revalidates this route, so the page re-renders from the database.
 */
export default function ResponderSelector({ choice, builderHref, readOnly = false }: Props) {
  const t = useT()
  const region = useRegionAttrs()
  const proLocked = useAccessDenied()
  const [confirming, setConfirming] = useState<ResponderKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const inFlight = useRef(false)
  const locked = readOnly || proLocked || pending

  function confirm(to: ResponderKind) {
    if (inFlight.current) return
    inFlight.current = true
    setError(null)
    return new Promise<void>((resolve) => {
      startTransition(async () => {
        try {
          const result = await setAutoResponseResponder({ to, from: choice.stored })
          if (result.ok === false) {
            const key = result.reason === 'conflict' || result.reason === 'unavailable' ? ERROR_KEY[result.reason] : null
            setError(t(key ?? 'admin.autoResponse.responder.error.unknown'))
          } else {
            toast('success', t(SAVED_KEY[result.responder]))
          }
        } catch {
          setError(t('admin.autoResponse.responder.error.unknown'))
        } finally {
          inFlight.current = false
          setConfirming(null)
          resolve()
        }
      })
    })
  }

  function card(kind: ResponderKind) {
    if (!choice) return setupPendingCard(kind)
    const option = choice[kind]
    const isActive = choice.active === kind
    const title = t(kind === 'agent' ? 'admin.autoResponse.responder.agentTitle' : 'admin.autoResponse.responder.questionnaireTitle')
    const description = t(kind === 'agent' ? 'admin.autoResponse.responder.agentBody' : 'admin.autoResponse.responder.questionnaireBody')
    const icon = kind === 'agent' ? 'sparkles' : 'list-check'
    const unavailable = !isActive && !option.available
    const editHref = kind === 'questionnaire' && builderHref ? builderHref : undefined

    return (
      <div key={kind} className='flex flex-col gap-2' data-responder-option={kind}>
        <OnboardingActionCard
          icon={icon}
          tileClass={unavailable ? 'bg-gray-400' : 'bg-primary'}
          title={title}
          description={description}
          fullDescription
          badge={isActive ? t('admin.autoResponse.responder.active') : unavailable ? t('admin.autoResponse.responder.unavailable') : undefined}
          badgeClass={isActive ? 'bg-primary text-white' : undefined}
          selected={isActive}
          disabled={unavailable || (locked && !isActive)}
          className='h-full'
          onClick={() => {
            if (isActive || locked || inFlight.current) return
            setError(null)
            setConfirming(kind)
          }}
        />
        {unavailable && option.available === false && (
          <p className='text-sm leading-relaxed text-gray-600'>
            {t(REASON_KEY[option.reason])}
            {option.reason === 'questionnaire_not_published' && editHref && (
              <>
                {' '}
                <Link href={editHref} className='font-medium text-ink underline underline-offset-2'>
                  {t('admin.autoResponse.responder.setupLink')}
                </Link>
              </>
            )}
          </p>
        )}
        {isActive && kind === 'questionnaire' && editHref && (
          <Link href={editHref} className='w-fit text-sm font-medium text-ink underline underline-offset-2'>
            {t('admin.autoResponse.responder.editLink')}
          </Link>
        )}
      </div>
    )
  }

  function setupPendingCard(kind: ResponderKind) {
    return (
      <div key={kind} className='flex flex-col gap-2' data-responder-option={kind}>
        <OnboardingActionCard
          icon={kind === 'agent' ? 'sparkles' : 'list-check'}
          tileClass='bg-gray-400'
          title={t(kind === 'agent' ? 'admin.autoResponse.responder.agentTitle' : 'admin.autoResponse.responder.questionnaireTitle')}
          description={t(kind === 'agent' ? 'admin.autoResponse.responder.agentBody' : 'admin.autoResponse.responder.questionnaireBody')}
          fullDescription
          disabled
          className='h-full'
        />
      </div>
    )
  }

  if (!choice) {
    return (
      <section className={readOnly ? '' : 'mt-8 max-w-4xl'} aria-labelledby='responder-heading' {...region}>
        <h2 id='responder-heading' className='text-base font-semibold text-ink'>
          {t('admin.autoResponse.responder.heading')}
        </h2>
        <p className='mt-1.5 text-sm leading-relaxed text-gray-800' role='status' data-responder-current='no_settings'>
          {readOnly ? t('admin.autoResponse.responder.noSettingsMobile') : t('admin.autoResponse.responder.noSettings')}
        </p>
        <div className='mt-4 grid gap-3 md:grid-cols-2'>
          {card('agent')}
          {card('questionnaire')}
        </div>
      </section>
    )
  }

  return (
    <section className={readOnly ? '' : 'mt-8 max-w-4xl'} aria-labelledby='responder-heading' {...region}>
      <h2 id='responder-heading' className='text-base font-semibold text-ink'>
        {t('admin.autoResponse.responder.heading')}
      </h2>
      <p className='mt-1.5 text-sm leading-relaxed text-gray-600'>
        {readOnly ? t('admin.autoResponse.responder.mobileHint') : t('admin.autoResponse.responder.hint')}
      </p>

      <div className='mt-4 grid gap-3 md:grid-cols-2'>
        {card('agent')}
        {card('questionnaire')}
      </div>

      <p className='mt-4 text-sm font-medium text-gray-800' role='status' data-responder-current={choice.current}>
        {t(CURRENT_KEY[choice.current])}
      </p>
      {choice.questionnaireStalled && (
        <p className='mt-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-gray-800'>
          {t('admin.autoResponse.responder.stalled')}{' '}
          {choice.questionnaire.available === false && t(REASON_KEY[choice.questionnaire.reason])}
        </p>
      )}
      {error && (
        <p className='mt-2 text-sm font-medium text-red-600' role='alert'>
          {error}
        </p>
      )}

      <ConfirmPop
        open={confirming !== null}
        onClose={() => {
          if (!inFlight.current) setConfirming(null)
        }}
        onConfirm={() => (confirming ? confirm(confirming) : undefined)}
        msg={confirming ? t(CONFIRM_KEY[confirming]) : ''}
        confirmLbl={
          confirming === 'questionnaire'
            ? t('admin.autoResponse.responder.confirm.questionnaireLbl')
            : t('admin.autoResponse.responder.confirm.agentLbl')
        }
        translated
      />
    </section>
  )
}
