'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { startWhatsappReminderActivation, turnOffWhatsappReminders } from '@/actions/whatsappReminders'
import { Btn } from '@/lib/btns/Btn'
import { Checkbox } from '@/lib/form'
import { toast } from '@/lib/toast'
import { OWNER_WA_CONSENT } from '@/lib/whatsapp/platform/consentText'
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
    ] as const
  ).map((k) => [HEBREW(k), k]),
)
const refusal = (msg: string, t: Translator) => (t.locale === 'he' ? msg : ERROR_KEYS.has(msg) ? t(ERROR_KEYS.get(msg)!) : msg)

/**
 * One card, four states: off / waiting for the code / active / stopped. The
 * code is shown once, right after it is issued; nothing is sent from here.
 */
export default function WhatsappReminderCard({ initial }: { initial: OwnerReminderView }) {
  const t = useT()
  const router = useRouter()
  const [consent, setConsent] = useState(false)
  const [issued, setIssued] = useState<{ code: string; waMeHref: string } | null>(null)
  const [busy, startTransition] = useTransition()

  function start() {
    startTransition(async () => {
      const res = await startWhatsappReminderActivation({ consent })
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

  if (initial.state === 'active') {
    return (
      <div className='space-y-4'>
        <p className='text-sm'>
          {t('settings.account.reminders.active')} <span dir='ltr'>{initial.maskedPhone}</span>
        </p>
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
        lbl={t.locale === 'he' ? OWNER_WA_CONSENT.text : <span {...untranslatedAttrs(t.locale)}>{OWNER_WA_CONSENT.text}</span>}
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
