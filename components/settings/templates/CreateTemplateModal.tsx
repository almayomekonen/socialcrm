'use client'

import { useRef, useState } from 'react'
import ModalPop from '@/lib/modals/ModalPop'
import { Btn } from '@/lib/btns/Btn'
import { FormField } from '@/lib/form'
import { validateTemplateInput } from '@/lib/whatsapp/templates/validate'
import { TEMPLATE_VARIABLES } from '@/lib/whatsapp/templates/messages'
import type { TemplateInput, TemplatePurpose } from '@/lib/whatsapp/templates/types'
import WhatsappMessagePreview from './WhatsappMessagePreview'
import { useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey } from '@/lib/i18n/translate'
import { templateSentence, variableLabel } from './templateCopy'

const PURPOSES: { value: TemplatePurpose; label: MessageKey; hint: MessageKey }[] = [
  { value: 'UTILITY', label: 'settings.templates.form.utility', hint: 'settings.templates.form.utilityHint' },
  { value: 'MARKETING', label: 'settings.templates.form.marketing', hint: 'settings.templates.form.marketingHint' },
]

const INPUT_CLASS =
  'h-10 w-full rounded-md border border-gray-200 bg-white px-3 focus:outline-2 focus:outline-offset-0 focus:outline-primary'

export default function CreateTemplateModal({
  open,
  onClose,
  onCreate,
  initial,
  heading,
  submitLabel,
  note,
}: {
  open: boolean
  onClose: () => void
  onCreate: (input: TemplateInput) => void
  /** Pre-fill (retry; "עריכת הודעה" = create-new). The caller remounts (via key) to reseed. */
  initial?: { displayTitle: string; bodyText: string; purpose?: TemplatePurpose }
  heading?: string
  submitLabel?: string
  /** Optional calm note under the heading (e.g. the edit → create-new explanation). */
  note?: string
}) {
  const t = useT()
  const [title, setTitle] = useState(initial?.displayTitle ?? '')
  const [body, setBody] = useState(initial?.bodyText ?? '')
  const [purpose, setPurpose] = useState<TemplatePurpose | ''>(initial?.purpose ?? '')
  const [errors, setErrors] = useState<string[]>([])
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  // Variables are derived from the body (closed set only) — no separate state.
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
    setTitle('')
    setBody('')
    setPurpose('')
    setErrors([])
  }

  const close = () => {
    reset()
    onClose()
  }

  const handleSubmit = () => {
    const input: TemplateInput = { displayTitle: title, bodyText: body, purpose: purpose as TemplatePurpose, variables }
    const result = validateTemplateInput(input)
    if ('errors' in result) {
      setErrors(result.errors.map((e) => templateSentence(e, t)))
      return
    }
    onCreate(input) // workspace handles optimistic insert + action + close
    reset()
  }

  return (
    <ModalPop
      open={open}
      onClose={close}
      labelledBy='create-template-title'
      pos='middle'
      className='w-[min(92vw,720px)]'
      translated
    >
      <h2 id='create-template-title' className='mb-1 text-lg font-semibold text-gray-800'>
        {heading ?? t('settings.templates.newMessage')}
      </h2>
      {note && <p className='mb-4 text-sm text-gray-500'>{note}</p>}

      <div className='grid gap-6 md:grid-cols-[1fr_260px]'>
        <div className='grid gap-4'>
          <FormField lbl={t('settings.templates.form.title')}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={INPUT_CLASS}
              placeholder={t('settings.templates.form.titlePlaceholder')}
            />
          </FormField>

          <FormField lbl={t('settings.templates.form.body')}>
            <textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className='w-full resize-none rounded-md border border-gray-200 bg-white p-3 text-sm focus:outline-2 focus:outline-offset-0 focus:outline-primary'
              placeholder={t('settings.templates.form.bodyPlaceholder')}
            />
          </FormField>

          <div className='flex flex-wrap items-center gap-2'>
            <span className='text-xs text-gray-500'>{t('settings.templates.form.personal')}</span>
            {TEMPLATE_VARIABLES.map((v) => (
              <button
                key={v.token}
                type='button'
                onClick={() => insertToken(v.token)}
                className='rounded-full border border-primary/30 bg-primary-tint px-3 py-1 text-xs text-primary-text hover:bg-primary-tint/70'
              >
                + {variableLabel(v.token, t)}
              </button>
            ))}
          </div>

          <fieldset className='grid gap-2'>
            <legend className='text-sm font-medium text-gray-700'>{t('settings.templates.form.purpose')}</legend>
            {PURPOSES.map((p) => (
              <label key={p.value} className='flex items-center gap-2 text-sm text-gray-700'>
                <input
                  type='radio'
                  name='template-purpose'
                  value={p.value}
                  checked={purpose === p.value}
                  onChange={() => setPurpose(p.value)}
                />
                <span>
                  {t(p.label)} <span className='text-gray-400'>({t(p.hint)})</span>
                </span>
              </label>
            ))}
          </fieldset>

          {errors.length > 0 && (
            <ul className='list-disc ps-5 text-sm text-error-text' role='alert'>
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className='mb-1 text-xs text-gray-500'>{t('settings.templates.form.previewLabel')}</p>
          <WhatsappMessagePreview bodyText={body} variables={variables} translated />
        </div>
      </div>

      <div className='mt-6 flex justify-end gap-2'>
        <Btn lbl={t('settings.templates.form.cancel')} variant='ghost' size='small' onClick={close} />
        <Btn lbl={submitLabel ?? t('settings.templates.submit')} size='small' onClick={handleSubmit} disabled={!title.trim() || !body.trim() || !purpose} />
      </div>
    </ModalPop>
  )
}
