import { Btn } from '@/lib/btns/Btn'
import { regionAttrs, type UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

type Props = {
  message: string
  showBilling?: boolean
  /** Validated client name, when a pending request exists. */ clientName?: string
  /** Interface language of the chrome (Phase F4); Hebrew by default. The message arrives already worded. */
  locale?: UiLocale
}

/** Consent cannot continue: say why in plain words and offer one way forward. */
export default function ConsentMessage({ message, showBilling = false, clientName, locale = 'he' }: Props) {
  const t = translatorFor(locale)
  return (
    <div className='mx-auto mt-16 max-w-md px-4' {...regionAttrs(locale)}>
      <div className='rounded-lg border border-gray-200 bg-white p-6 flex flex-col gap-4'>
        <h1 className='text-lg font-bold'>{clientName ? t('auth.oauth.heading', { client: clientName }) : t('auth.oauth.title')}</h1>
        <p className='text-sm text-gray-600'>{message}</p>
        <div className='mt-auto flex items-center justify-end gap-3'>
          <Btn href='/dashboard' lbl={t('auth.oauth.back')} variant='outline' />
          {showBilling ? <Btn href='/settings/update_payment' lbl={t('auth.oauth.billing')} /> : null}
        </div>
      </div>
    </div>
  )
}
