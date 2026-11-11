'use client'

import { useRef } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import { translatorFor } from '@/lib/i18n/translators'
import { useAutoGrow } from '@/hooks/useAutoGrow'

const HEBREW = translatorFor('he')

/**
 * One labelled free-text field on the מענה אוטומטי form.
 *
 * ONE LABEL PATTERN. Label, then the short hint under it, then the box — every
 * field on the page reads in that order. The box grows with its content instead
 * of scrolling inside a few fixed rows; `rows` is its minimum height.
 *
 * `sent` is the field's whole reason for existing as a component. The old form
 * had ONE textarea whose meaning flipped with a radio and never said which text
 * a customer would actually receive. The fields whose words go to the customer
 * verbatim carry one clear badge next to the label; the internal fields carry
 * none, instead of every field repeating that it is not sent.
 *
 * The counter is numbers in a right-to-left line, so it is isolated as LTR
 * (`<bdi dir="ltr">`) to read "752 / 1000", and turns warning at 90% of the limit
 * and error at the limit. The numbers stay, so colour is never the only signal.
 */
type Props = {
  id: string
  label: string
  hint: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  maxLength: number
  /** true ⇒ customers receive this text verbatim. false ⇒ only the agent reads it. */
  sent: boolean
  rows?: number
  error?: string
  /** Follow the interface language (the auto-response fixed message, the questionnaire builder). Default Hebrew: the Smart Agent's AI fields stay Hebrew (owner order). */
  translated?: boolean
}

/** Counter colour: 90% of the limit warns, the limit itself is an error. */
export function counterTone(length: number, max: number): 'normal' | 'warning' | 'error' {
  if (max <= 0) return 'normal'
  if (length >= max) return 'error'
  if (length >= max * 0.9) return 'warning'
  return 'normal'
}

const TONE_CLASS = { normal: 'text-gray-500', warning: 'font-medium text-warning-text', error: 'font-medium text-error-text' } as const

export default function AutoResponseTextField({
  id,
  label,
  hint,
  value,
  onChange,
  placeholder,
  maxLength,
  sent,
  rows = 3,
  error,
  translated = false,
}: Props) {
  const ui = useT()
  const t = translated ? ui : HEBREW
  const ref = useRef<HTMLTextAreaElement>(null)
  useAutoGrow(ref, value)
  const tone = counterTone(value.length, maxLength)

  return (
    <div>
      <div className='flex flex-wrap items-center gap-2'>
        <label htmlFor={id} className='text-sm font-semibold text-gray-700'>
          {label}
        </label>
        {sent && (
          <span className='rounded-full bg-primary-tint px-2 py-0.5 text-[11px] font-medium text-primary-text' data-sent-badge>
            {t('admin.autoResponse.field.sentBadge')}
          </span>
        )}
      </div>
      <p id={`${id}-hint`} className='mt-0.5 text-xs leading-relaxed text-gray-500'>
        {hint}
      </p>

      <div className='mt-2 rounded-md border border-gray-200 bg-white focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-primary aria-invalid:border-red-500 aria-invalid:focus-within:outline-red-200'>
        <textarea
          ref={ref}
          id={id}
          rows={rows}
          maxLength={maxLength}
          className='block w-full resize-none overflow-hidden bg-transparent px-4 pt-3.5 text-sm leading-relaxed outline-none'
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-hint ${id}-error` : `${id}-hint`}
          placeholder={placeholder}
        />
        <div className='mx-4 flex items-center justify-end border-t border-gray-100 py-2 text-xs'>
          <bdi dir='ltr' className={TONE_CLASS[tone]} data-counter-tone={tone}>
            {value.length} / {maxLength}
          </bdi>
        </div>
      </div>

      {error && (
        <p id={`${id}-error`} role='alert' className='mt-1 text-sm text-red-600'>
          {error}
        </p>
      )}
    </div>
  )
}
