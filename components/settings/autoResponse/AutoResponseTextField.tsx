'use client'

/**
 * One labelled free-text field on the מענה אוטומטי form.
 *
 * Extracted because the form now shows three of these rather than one, and
 * `AutoResponseSettingsForm.tsx` was already at the 350-line hard limit
 * (architecture-rules §1, §5). The markup is the form's existing field pattern
 * moved intact — label + hint row, bordered box with a focus ring, footer with a
 * note and a character count. Nothing new is invented here.
 *
 * `sent` is the field's whole reason for existing as a component. The old form
 * had ONE textarea whose meaning flipped with a radio, labelled "על העסק שלכם"
 * in one mode and "ההודעה שתישלח" in the other, and never said which text a
 * customer would actually receive. An owner who wrote a welcome message into the
 * smart-reply box had it silently read as a description of the business. This
 * prop forces every field to answer that question on screen.
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
}

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
}: Props) {
  return (
    <div>
      <div className='flex items-baseline gap-2.5'>
        <label htmlFor={id} className='text-sm font-semibold text-gray-700'>
          {label}
        </label>
        <p className='text-xs text-gray-500'>{hint}</p>
      </div>

      <div className='mt-3.5 rounded-md border border-gray-200 bg-white focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-primary aria-invalid:border-red-500 aria-invalid:focus-within:outline-red-200'>
        <textarea
          id={id}
          rows={rows}
          maxLength={maxLength}
          className='block w-full resize-none bg-transparent px-4 pt-3.5 text-sm leading-relaxed outline-none'
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : `${id}-note`}
          placeholder={placeholder}
        />
        <div className='mx-4 flex items-center justify-between border-t border-gray-100 py-2 text-xs text-gray-500'>
          <span id={`${id}-note`}>{sent ? 'הטקסט הזה נשלח ללקוח כלשונו' : 'הטקסט הזה לא נשלח ללקוח'}</span>
          <span>
            {value.length} / {maxLength}
          </span>
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
