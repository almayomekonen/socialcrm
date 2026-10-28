'use client'

import { useState } from 'react'
import { Select } from '@/lib/form'
import { Btn } from '@/lib/btns/Btn'
import { toast } from '@/lib/toast'
import { setAgencyDefaultUiLocale, setMyUiLocale } from '@/actions/uiLocale'
import { useRegionAttrs, useT } from '@/lib/i18n/I18nProvider'
import { LOCALE_META, UI_LOCALES, isUiLocale, type UiLocale } from '@/lib/i18n/config'
import { agencyDefaultLocale, type LocaleSource } from '@/lib/i18n/resolve'
import { createTranslator, type MessageKey } from '@/lib/i18n/translate'
import { CATALOGS } from '@/lib/i18n/messages'

const LANGUAGE_OPTIONS = UI_LOCALES.map((code) => ({ id: code, name: LOCALE_META[code].nativeName }))

const EFFECTIVE_LINE: Record<LocaleSource, MessageKey> = {
  user: 'language.effectiveFromUser',
  agency: 'language.effectiveFromAgency',
  default: 'language.effectiveFromDefault',
}

/** Confirm in the language the user is about to see, not the one they are leaving. */
function sayIn(locale: UiLocale, key: MessageKey) {
  return createTranslator(locale, CATALOGS[locale])(key)
}

export default function LanguageSettings({
  locale,
  source,
  userLocale,
  agencyLocale,
  canManageAgency,
}: {
  locale: UiLocale
  source: LocaleSource
  userLocale: string | null
  agencyLocale: string | null
  canManageAgency: boolean
}) {
  const t = useT()
  const region = useRegionAttrs()
  const agencyDefault = agencyDefaultLocale(agencyLocale)
  const [agencyChoice, setAgencyChoice] = useState<UiLocale>(agencyDefault)

  async function savePersonal(formData: FormData) {
    const value = String(formData.get('locale') ?? '')
    const next = isUiLocale(value) ? value : agencyDefault
    try {
      await setMyUiLocale(value)
      toast('success', sayIn(next, 'language.savedPersonal'))
    } catch {
      toast('error', t('language.saveError'))
    }
  }

  async function saveAgency(formData: FormData) {
    const value = String(formData.get('locale') ?? '')
    try {
      await setAgencyDefaultUiLocale(value)
      // The admin's own screen changes only if they have no personal choice.
      toast('success', sayIn(isUiLocale(userLocale) ? locale : agencyChoice, 'language.savedAgency'))
    } catch {
      toast('error', t('language.saveError'))
    }
  }

  return (
    // Full-width island so the column aligns to the start of ITS direction, not
    // the Hebrew settings cell it sits in.
    <div {...region}>
      <div className='max-w-2xl'>
        <h1 className='title mb-2'>{t('language.pageTitle')}</h1>
        <p className='text-sm text-gray-500 mb-8'>{t('language.intro')}</p>

        <form action={savePersonal} className='border rounded-lg bg-white p-6 mb-6 grid gap-4'>
          <div className='grid gap-1'>
            <h2 className='font-semibold'>{t('language.personalTitle')}</h2>
            <p className='text-sm text-gray-500'>{t('language.personalHelp')}</p>
          </div>
          <Select
            // Re-mount when the saved value changes, so the uncontrolled field
            // shows what was just saved without a reload.
            key={userLocale ?? ''}
            lbl={t('language.personalLabel')}
            name='locale'
            required={false}
            defaultValue={isUiLocale(userLocale) ? userLocale : ''}
            options={[
              { id: '', name: t('language.useAgencyDefault', { language: LOCALE_META[agencyDefault].nativeName }) },
              ...LANGUAGE_OPTIONS,
            ]}
          />
          <p className='text-sm' role='status'>
            {t(EFFECTIVE_LINE[source], { language: LOCALE_META[locale].nativeName })}
          </p>
          <Btn as='submit' lbl={t('language.savePersonal')} />
        </form>

        {canManageAgency && (
          <form action={saveAgency} className='border rounded-lg bg-white p-6 mb-6 grid gap-4'>
            <div className='grid gap-1'>
              <h2 className='font-semibold'>{t('language.agencyTitle')}</h2>
              <p className='text-sm text-gray-500'>{t('language.agencyHelp')}</p>
            </div>
            <Select
              lbl={t('language.agencyLabel')}
              name='locale'
              value={agencyChoice}
              onChange={(e) => isUiLocale(e.target.value) && setAgencyChoice(e.target.value)}
              options={LANGUAGE_OPTIONS}
            />
            {agencyChoice !== agencyDefault && (
              <p className='text-sm' role='status'>
                {t('language.agencyChangePreview', {
                  from: LOCALE_META[agencyDefault].nativeName,
                  to: LOCALE_META[agencyChoice].nativeName,
                })}
              </p>
            )}
            <Btn as='submit' lbl={t('language.saveAgency')} />
          </form>
        )}
      </div>
    </div>
  )
}
