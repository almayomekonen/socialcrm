'use client'

import { useEffect, useState } from 'react'
import Icon from '@/lib/Icon'
import { useT } from '@/lib/i18n/I18nProvider'
import { customerTextAttrs } from '@/lib/i18n/config'
import { rtlOrRegionAttrs } from '@/lib/i18n/preLoginLocale'

/**
 * "Lead arriving" toasts over the blurred dashboard behind the trial-expired
 * card. Shows up to 3 of the user's real leads, one after another, then stops —
 * not a perpetual loop. Styled to match the app toast exactly (lib/toast.tsx +
 * .toast in elements.css): black pill, bottom-right, icon + message. Names are
 * real CRM data; purely visual (pointer-events-none), never blocks the gate.
 */
const MAX_TOASTS = 3

export default function LeadEntryToasts({ names }: { names: string[] }) {
  const t = useT()
  const count = Math.min(MAX_TOASTS, names.length)
  const [step, setStep] = useState(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (step >= count) return
    const slideIn = setTimeout(() => setVisible(true), 120)
    const slideOut = setTimeout(() => setVisible(false), 2600)
    const advance = setTimeout(() => setStep((s) => s + 1), 3100)
    return () => {
      clearTimeout(slideIn)
      clearTimeout(slideOut)
      clearTimeout(advance)
    }
  }, [step, count])

  if (step >= count) return null
  const name = names[step] || t('trial.expired.leadFallback')

  return (
    <div className='pointer-events-none absolute bottom-8 right-8 z-0'>
      <div
        {...rtlOrRegionAttrs(t.locale)}
        className={`rounded-sm bg-black/85 shadow-lg transition-all duration-500 ease-out motion-reduce:transition-none ${
          visible ? 'translate-x-0 opacity-100' : '-translate-x-8 opacity-0'
        }`}
      >
        <div className='flex items-center gap-4 ps-6 pe-9 py-3 font-medium text-white'>
          <Icon name='users' type='reg' className='size-5 bg-white' />
          <h3 className='font-medium leading-snug whitespace-pre-line' {...(names[step] ? customerTextAttrs(t.locale) : {})}>{name}</h3>
        </div>
      </div>
    </div>
  )
}
