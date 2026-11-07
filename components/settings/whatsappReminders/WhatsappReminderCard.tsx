'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  grantPersonalReminders,
  grantWhatsappAssistantConsent,
  startWhatsappReminderActivation,
  turnOffWhatsappReminders,
  withdrawPersonalReminders,
  withdrawWhatsappAssistantConsent,
} from '@/actions/whatsappReminders'
import { Btn } from '@/lib/btns/Btn'
import { Checkbox } from '@/lib/form'
import { toast } from '@/lib/toast'
import {
  OWNER_WA_ASSISTANT_CONSENT,
  OWNER_WA_CONSENT,
  OWNER_WA_PERSONAL_REMINDERS_CONSENT,
  type OwnerWaConsent,
} from '@/lib/whatsapp/platform/consentText'
import type { OwnerReminderView } from '@/lib/whatsapp/platform/ownerReminderView'
import { useT } from '@/lib/i18n/I18nProvider'
import type { Translator, MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'
import { untranslatedAttrs } from '@/lib/i18n/config'

/** The reminder actions' Hebrew refusals (actions/whatsappReminders.ts, unchanged), worded by exact sentence; others as returned. */
const HEBREW = translatorFor('he')
const ERROR_KEYS = new Map<string, MessageKey>(
  (
    [
      'settings.account.reminders.error.noPermission',
      'settings.account.reminders.error.unavailable',
      'settings.account.reminders.error.consent',
      'settings.account.reminders.error.alreadyActive',
      'settings.account.reminders.error.codeFailed',
      'settings.account.reminders.error.noAuth',
      'settings.account.reminders.error.assistantUnavailable',
      'settings.account.reminders.error.assistantConsent',
      'settings.account.reminders.error.staleConsent',
      'settings.account.reminders.error.notVerified',
      'settings.account.reminders.error.personalUnavailable',
      'settings.account.reminders.error.personalConsent',
    ] as const
  ).map((k) => [HEBREW(k), k]),
)
const refusal = (msg: string, t: Translator) => (t.locale === 'he' ? msg : ERROR_KEYS.has(msg) ? t(ERROR_KEYS.get(msg)!) : msg)

/** A recorded consent sentence stays Hebrew: in a Hebrew region outside Hebrew. */
const consentLabel = (text: string, t: Translator) => (t.locale === 'he' ? text : <span {...untranslatedAttrs(t.locale)}>{text}</span>)

/**
 * One card, four states: off / waiting for the code / active / stopped. The
 * code is shown once, right after it is issued; nothing is sent from here.
 *
 * `consent` is the sentence the server will record with the code (v3 where the
 * assistant is enabled, v2 elsewhere); its version is sent back so the server
 * records only the text shown. An active row of an assistant agency also shows
 * the assistant's own consent: grant it, or withdraw it while reminders stay on.
 */
export default function WhatsappReminderCard({ initial, consent: shown = OWNER_WA_CONSENT }: { initial: OwnerReminderView; consent?: OwnerWaConsent }) {
  const t = useT()
  const router = useRouter()
  const [consent, setConsent] = useState(false)
  const [assistantConsent, setAssistantConsent] = useState(false)
  const [personalConsent, setPersonalConsent] = useState(false)
  const [issued, setIssued] = useState<{ code: string; waMeHref: string } | null>(null)
  const [busy, startTransition] = useTransition()

  function start() {
    startTransition(async () => {
      const res = await startWhatsappReminderActivation({ consent, consentVersion: shown.version })
      if ('fail' in res) return toast('error', refusal(res.msg, t))
      setIssued({ code: res.code, waMeHref: res.waMeHref })
    })
  }

  function turnOff() {
    startTransition(async () => {
      const res = await turnOffWhatsappReminders()
      if ('fail' in res) return toast('error', refusal(res.msg, t))
      setIssued(null)
      setConsent(false)
      toast('success', t('settings.account.reminders.turnedOff'))
      router.refresh()
    })
  }

  function grantAssistant() {
    startTransition(async () => {
      const res = await grantWhatsappAssistantConsent({ consent: assistantConsent, consentVersion: OWNER_WA_ASSISTANT_CONSENT.version })
      if ('fail' in res) return toast('error', refusal(res.msg, t))
      setAssistantConsent(false)
      toast('success', t('settings.account.reminders.assistant.grantedToast'))
      router.refresh()
    })
  }

  function withdrawAssistant() {
    startTransition(async () => {
      const res = await withdrawWhatsappAssistantConsent()
      if ('fail' in res) return toast('error', refusal(res.msg, t))
      toast('success', t('settings.account.reminders.assistant.withdrawn'))
      router.refresh()
    })
  }

  function grantPersonal() {
    startTransition(async () => {
      const res = await grantPersonalReminders({ consent: personalConsent, consentVersion: OWNER_WA_PERSONAL_REMINDERS_CONSENT.version })
      if ('fail' in res) return toast('error', refusal(res.msg, t))
      setPersonalConsent(false)
      toast('success', t('settings.account.reminders.personal.grantedToast'))
      router.refresh()
    })
  }

  function withdrawPersonal() {
    startTransition(async () => {
      const res = await withdrawPersonalReminders()
      if ('fail' in res) return toast('error', refusal(res.msg, t))
      toast('success', t(res.inFlight > 0 ? 'settings.account.reminders.personal.withdrawnInFlight' : 'settings.account.reminders.personal.withdrawn'))
      router.refresh()
    })
  }

  if (initial.state === 'active') {
    return (
      <div className='space-y-4'>
        <p className='text-sm'>
          {t('settings.account.reminders.active')} <span dir='ltr'>{initial.maskedPhone}</span>
        </p>
        {initial.assistant === 'granted' && (
          <div className='space-y-3'>
            <p className='text-sm'>{t('settings.account.reminders.assistant.granted')}</p>
            <Btn type='button' variant='outline' lbl={t('settings.account.reminders.assistant.withdraw')} onClick={withdrawAssistant} disabled={busy} />
          </div>
        )}
        {initial.assistant === 'consent_required' && (
          <div className='space-y-3'>
            <p className='text-sm text-gray-600 leading-relaxed'>{t('settings.account.reminders.assistant.offer')}</p>
            <Checkbox
              lbl={consentLabel(OWNER_WA_ASSISTANT_CONSENT.text, t)}
              checked={assistantConsent}
              onChange={(e) => setAssistantConsent(e.target.checked)}
            />
            <Btn
              type='button'
              lbl={t('settings.account.reminders.assistant.grant')}
              onClick={grantAssistant}
              disabled={!assistantConsent || busy}
              title={assistantConsent ? undefined : t('settings.account.reminders.assistant.consentRequired')}
            />
          </div>
        )}
        {initial.personalReminders === 'granted' && (
          <div className='space-y-3'>
            <p className='text-sm'>{t('settings.account.reminders.personal.granted')}</p>
            <Btn type='button' variant='outline' lbl={t('settings.account.reminders.personal.withdraw')} onClick={withdrawPersonal} disabled={busy} />
          </div>
        )}
        {initial.personalReminders === 'consent_required' && (
          <div className='space-y-3'>
            <p className='text-sm text-gray-600 leading-relaxed'>{t('settings.account.reminders.personal.offer')}</p>
            <Checkbox
              lbl={consentLabel(OWNER_WA_PERSONAL_REMINDERS_CONSENT.text, t)}
              checked={personalConsent}
              onChange={(e) => setPersonalConsent(e.target.checked)}
            />
            <Btn
              type='button'
              lbl={t('settings.account.reminders.personal.grant')}
              onClick={grantPersonal}
              disabled={!personalConsent || busy}
              title={personalConsent ? undefined : t('settings.account.reminders.personal.consentRequired')}
            />
          </div>
        )}
        <p className='text-sm text-gray-600 leading-relaxed'>{t('settings.account.reminders.stopHint')}</p>
        <Btn type='button' variant='outline' lbl={t('settings.account.reminders.turnOff')} onClick={turnOff} disabled={busy} />
      </div>
    )
  }

  if (issued) {
    return (
      <div className='space-y-4'>
        <p className='text-sm'>{t('settings.account.reminders.sendCode')}</p>
        <p dir='ltr' className='text-2xl font-semibold tracking-widest text-center'>
          {issued.code}
        </p>
        <p className='text-sm text-gray-600 leading-relaxed'>{t('settings.account.reminders.codeValid')}</p>
        <div className='flex flex-wrap gap-3'>
          <Btn
            type='button'
            lbl={t('settings.account.reminders.openWhatsapp')}
            onClick={() => window.open(issued.waMeHref, '_blank', 'noopener,noreferrer')}
          />
          <Btn type='button' variant='outline' lbl={t('settings.account.reminders.check')} onClick={() => router.refresh()} />
        </div>
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      {initial.state === 'opted_out' && <p className='text-sm'>{t('settings.account.reminders.off')}</p>}
      {initial.state === 'pending' && (
        <p className='text-sm text-gray-600 leading-relaxed'>
          {t('settings.account.reminders.pending')}
        </p>
      )}
      {/* The consent sentence is recorded with its version (lib/whatsapp/platform/consentText.ts): it stays Hebrew, in a Hebrew region outside Hebrew. */}
      <Checkbox
        lbl={consentLabel(shown.text, t)}
        checked={consent}
        onChange={(e) => setConsent(e.target.checked)}
      />
      <Btn
        type='button'
        lbl={initial.state === 'pending' ? t('settings.account.reminders.newCode') : t('settings.account.reminders.start')}
        onClick={start}
        disabled={!consent || busy}
        title={consent ? undefined : t('settings.account.reminders.consentRequired')}
      />
      {initial.state === 'pending' && (
        <Btn type='button' variant='outline' lbl={t('settings.account.reminders.cancel')} onClick={turnOff} disabled={busy} />
      )}
    </div>
  )
}
