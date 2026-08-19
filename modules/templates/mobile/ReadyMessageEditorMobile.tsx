'use client'

import { useRef, useState } from 'react'
import BottomSheet from '@/components/mobile/BottomSheet'
import { validateTemplateInput } from '@/lib/whatsapp/templates/validate'
import { TEMPLATE_VARIABLES } from '@/lib/whatsapp/templates/messages'
import type { TemplateInput, TemplatePurpose } from '@/lib/whatsapp/templates/types'
import WhatsappMessagePreview from '@/components/settings/templates/WhatsappMessagePreview'

const PURPOSES: { value: TemplatePurpose; label: string; hint: string }[] = [
  { value: 'UTILITY', label: 'עדכון או תזכורת לליד', hint: 'סטטוס, תזכורת, מענה' },
  { value: 'MARKETING', label: 'מבצע או הצעה שיווקית', hint: 'קופון, מבצע, השקה' },
]

const FIELD =
  'h-11 w-full rounded-md border border-gray-200 bg-white px-3 text-base focus:outline-2 focus:outline-offset-0 focus:outline-primary'

/**
 * Phone create / edit editor. Same TemplateInput + validateTemplateInput as
 * CreateTemplateModal. Edit is still create-new — this component only changes
 * the surface (sheet, stacked fields, 16px inputs, 44px CTAs).
 */
export default function ReadyMessageEditorMobile({
  open,
  onClose,
  onCreate,
  heading,
  submitLabel,
  note,
  initial,
}: {
  open: boolean
  onClose: () => void
  onCreate: (input: TemplateInput) => void
  heading: string
  submitLabel: string
  note?: string
  initial?: { displayTitle: string; bodyText: string; purpose?: TemplatePurpose }
}) {
  const [title, setTitle] = useState(initial?.displayTitle ?? '')
  const [body, setBody] = useState(initial?.bodyText ?? '')
  const [purpose, setPurpose] = useState<TemplatePurpose | ''>(initial?.purpose ?? '')
  const [errors, setErrors] = useState<string[]>([])
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const variables = TEMPLATE_VARIABLES.filter((v) => body.includes(v.token)).map((v) => ({
    token: v.token,
    sample: v.defaultSample,
  }))

  const insertToken = (token: string) => {
    const el = bodyRef.current
    const start = el?.selectionStart ?? body.length
    const end = el?.selectionEnd ?? body.length
    setBody((b) => b.slice(0, start) + token + b.slice(end))
    requestAnimationFrame(() => {
      if (!el) return
      const caret = start + token.length
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }

  const reset = () => {
    setTitle(initial?.displayTitle ?? '')
    setBody(initial?.bodyText ?? '')
    setPurpose(initial?.purpose ?? '')
    setErrors([])
  }

  const close = () => {
    reset()
    onClose()
  }

  const handleSubmit = () => {
    const input: TemplateInput = {
      displayTitle: title,
      bodyText: body,
      purpose: purpose as TemplatePurpose,
      variables,
    }
    const result = validateTemplateInput(input)
    if ('errors' in result) {
      setErrors(result.errors)
      return
    }
    onCreate(input)
    reset()
  }

  return (
    <BottomSheet open={open} onClose={close} title={heading} titleId='ready-message-editor-title' dismissOnScrim={false}>
      <form
        className='flex flex-col gap-4'
        aria-labelledby='ready-message-editor-title'
        onSubmit={(e) => {
          e.preventDefault()
          handleSubmit()
        }}
      >
        {note && <p className='text-sm leading-relaxed text-gray-500'>{note}</p>}

        <label className='grid gap-1.5'>
          <span className='text-sm font-medium text-ink'>שם ההודעה</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={FIELD}
            placeholder='למשל: תזכורת פולואפ'
          />
        </label>

        <label className='grid gap-1.5'>
          <span className='text-sm font-medium text-ink'>תוכן ההודעה</span>
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            className='min-h-24 w-full resize-none rounded-md border border-gray-200 bg-white p-3 text-base focus:outline-2 focus:outline-offset-0 focus:outline-primary'
            placeholder='כתבו את ההודעה שתישלח ללידים...'
          />
        </label>

        <div>
          <p className='mb-2 text-sm text-gray-500'>הוספת פרטים אישיים</p>
          <div className='flex flex-wrap gap-2'>
            {TEMPLATE_VARIABLES.map((v) => (
              <button
                key={v.token}
                type='button'
                onClick={() => insertToken(v.token)}
                className='press flex min-h-11 items-center rounded-full border border-primary/30 bg-primary-tint px-4 text-sm text-primary-text hover:bg-primary-tint/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
              >
                {v.token}
              </button>
            ))}
          </div>
        </div>

        <fieldset className='grid gap-2'>
          <legend className='text-sm font-medium text-ink'>מה מטרת ההודעה?</legend>
          {PURPOSES.map((p) => (
            <label
              key={p.value}
              className={`flex min-h-11 items-center gap-3 rounded-md border px-3 ${
                purpose === p.value ? 'border-primary bg-primary-tint/40' : 'border-gray-200 bg-white'
              }`}
            >
              <input
                type='radio'
                name='template-purpose'
                value={p.value}
                checked={purpose === p.value}
                onChange={() => setPurpose(p.value)}
                className='size-4'
              />
              <span className='text-sm text-ink'>
                {p.label} <span className='text-gray-400'>({p.hint})</span>
              </span>
            </label>
          ))}
        </fieldset>

        {variables.length > 0 && (
          <p className='text-sm text-gray-500'>
            פרטים שיוחלפו בשליחה: {variables.map((v) => v.token).join(' · ')}
          </p>
        )}

        {errors.length > 0 && (
          <ul className='list-disc ps-5 text-sm text-error-text' role='alert'>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}

        <div>
          <p className='mb-1.5 text-sm text-gray-500'>כך הליד יראה את ההודעה</p>
          <WhatsappMessagePreview bodyText={body} variables={variables} />
        </div>

        <button
          type='submit'
          disabled={!title.trim() || !body.trim() || !purpose}
          className='press flex min-h-11 w-full items-center justify-center rounded-md bg-solid font-medium text-white hover:bg-solid/85 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        >
          {submitLabel}
        </button>
        <button
          type='button'
          onClick={close}
          className='press flex min-h-11 w-full items-center justify-center rounded-md border border-gray-200 bg-white font-medium text-ink hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        >
          ביטול
        </button>
      </form>
    </BottomSheet>
  )
}
