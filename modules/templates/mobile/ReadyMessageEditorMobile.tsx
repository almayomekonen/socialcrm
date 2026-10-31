'use client'

import { useRef, useState } from 'react'
import BottomSheet from '@/components/mobile/BottomSheet'
import { validateTemplateInput } from '@/lib/whatsapp/templates/validate'
import { TEMPLATE_VARIABLES } from '@/lib/whatsapp/templates/messages'
import type { TemplateInput, TemplatePurpose } from '@/lib/whatsapp/templates/types'
import WhatsappMessagePreview from '@/components/settings/templates/WhatsappMessagePreview'
import { templateSentence, variableLabel } from '@/components/settings/templates/templateCopy'
import { useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey } from '@/lib/i18n/translate'

const PURPOSES: { value: TemplatePurpose; label: MessageKey; hint: MessageKey }[] = [
  { value: 'UTILITY', label: 'settings.mobile.ready.utility', hint: 'settings.templates.form.utilityHint' },
  { value: 'MARKETING', label: 'settings.templates.form.marketing', hint: 'settings.templates.form.marketingHint' },
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
  const t = useT()
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
      setErrors(result.errors.map((e) => templateSentence(e, t)))
      return
    }
    onCreate(input)
    reset()
  }

  return (
    <BottomSheet open={open} onClose={close} title={heading} titleId='ready-message-editor-title' dismissOnScrim={false} translated>
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
          <span className='text-sm font-medium text-ink'>{t('settings.templates.form.title')}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={FIELD}
            placeholder={t('settings.templates.form.titlePlaceholder')}
          />
        </label>

        <label className='grid gap-1.5'>
          <span className='text-sm font-medium text-ink'>{t('settings.templates.form.body')}</span>
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            className='min-h-24 w-full resize-none rounded-md border border-gray-200 bg-white p-3 text-base focus:outline-2 focus:outline-offset-0 focus:outline-primary'
            placeholder={t('settings.templates.form.bodyPlaceholder')}
          />
        </label>

        <div>
          <p className='mb-2 text-sm text-gray-500'>{t('settings.mobile.ready.personal')}</p>
          <div className='flex flex-wrap gap-2'>
            {TEMPLATE_VARIABLES.map((v) => (
              <button
                key={v.token}
                type='button'
                onClick={() => insertToken(v.token)}
                className='press flex min-h-11 items-center rounded-full border border-primary/30 bg-primary-tint px-4 text-sm text-primary-text hover:bg-primary-tint/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
              >
                {variableLabel(v.token, t)}
              </button>
            ))}
          </div>
        </div>

        <fieldset className='grid gap-2'>
          <legend className='text-sm font-medium text-ink'>{t('settings.templates.form.purpose')}</legend>
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
                {t(p.label)} <span className='text-gray-400'>({t(p.hint)})</span>
              </span>
            </label>
          ))}
        </fieldset>

        {variables.length > 0 && (
          <p className='text-sm text-gray-500'>
            {t('settings.mobile.ready.replaced', { tokens: variables.map((v) => variableLabel(v.token, t)).join(' · ') })}
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
          <p className='mb-1.5 text-sm text-gray-500'>{t('settings.templates.form.previewLabel')}</p>
          <WhatsappMessagePreview bodyText={body} variables={variables} translated />
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
          {t('settings.templates.form.cancel')}
        </button>
      </form>
    </BottomSheet>
  )
}
