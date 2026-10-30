'use client'

import { useState, useTransition } from 'react'
import ModalPop from '@/lib/modals/ModalPop'
import { Btn } from '@/lib/btns/Btn'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { Input } from '@/lib/form'
import { Seperator } from '@/lib/Seperator'
import { toast } from '@/lib/toast'
import { saveQuoteTemplateAction } from '@/actions/quotes/templates'
import {
  MAX_NAME_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_VALIDITY_DAYS,
  MIN_VALIDITY_DAYS,
  validateQuoteTemplateDraft,
  type QuoteTemplateDraft,
  type QuoteTemplateItemDraft,
} from '@/lib/quotes/templateValidation'
import QuoteTemplateItemsEditor from './QuoteTemplateItemsEditor'
import { quoteTemplateErrorMessage } from './templateCopy'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * Create / edit in ONE sheet — the `AutomationSheet` shape, reused rather than
 * redesigned: a `ModalPop`, sections divided by hairlines, local state
 * throughout, one save.
 *
 * The whole document is saved atomically, so a template is never left with new
 * lines and an old name, or half its items replaced.
 *
 * Validation runs the SAME pure function the Server Action runs. The button is
 * not disabled on invalid input — a disabled control with no stated reason is
 * the failure `ux-guidelines` §3 names — so the sheet says what is wrong and the
 * server checks again regardless.
 */

export type TemplateSheetDraft = QuoteTemplateDraft & { id?: number | null }

export const BLANK_TEMPLATE: TemplateSheetDraft = {
  id: null,
  name: '',
  title: '',
  introText: '',
  termsText: '',
  validityDays: 14,
  items: [{ title: '', description: '', quantity: 1, unitPrice: 0, discount: 0, isOptional: false }],
}

export default function QuoteTemplateSheet({
  draft,
  onClose,
  onSaved,
}: {
  draft: TemplateSheetDraft
  onClose: () => void
  onSaved: () => void
}) {
  const t = useT()
  const [name, setName] = useState(draft.name)
  const [title, setTitle] = useState(draft.title)
  const [introText, setIntroText] = useState(draft.introText)
  const [termsText, setTermsText] = useState(draft.termsText)
  const [validityDays, setValidityDays] = useState(String(draft.validityDays))
  const [items, setItems] = useState<QuoteTemplateItemDraft[]>(draft.items)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const current = (): QuoteTemplateDraft => ({
    name,
    title,
    introText,
    termsText,
    validityDays: Math.trunc(Number(validityDays)) || 0,
    items,
  })

  /**
   * TIER 2. The template and its prices stay readable and explorable; saving is
   * the Pro action, so the gate sits on the write and nowhere else.
   */
  const proLocked = useAccessDenied()

  function save() {
    setError(null)
    const issue = validateQuoteTemplateDraft(current())
    if (issue) return setError(quoteTemplateErrorMessage(issue, t.locale))

    startTransition(async () => {
      const res = await saveQuoteTemplateAction({ templateId: draft.id ?? null, draft: current() })
      if ('reason' in res) return setError(quoteTemplateErrorMessage(res.reason, t.locale))
      toast('success', draft.id ? t('admin.quotes.sheet.updatedToast') : t('admin.quotes.sheet.savedToast'))
      onSaved()
    })
  }

  return (
    <ModalPop open onClose={onClose} pos='top' label={draft.id ? t('admin.quotes.sheet.editTitle') : t('admin.quotes.sheet.newTitle')} translated>
      <div className='grid gap-5 w-[min(90vw,560px)] pt-2'>
        <h2 className='text-lg font-semibold text-gray-800'>
          {draft.id ? t('admin.quotes.sheet.editTitle') : t('admin.quotes.sheet.newTitle')}
        </h2>

        <Input
          lbl={t('admin.quotes.sheet.name')}
          info={t('admin.quotes.sheet.nameInfo')}
          value={name}
          maxLength={MAX_NAME_LENGTH}
          onChange={(e) => setName(e.target.value)}
        />

        <Input
          lbl={t('admin.quotes.sheet.offerTitle')}
          info={t('admin.quotes.sheet.offerTitleInfo')}
          required={false}
          value={title}
          maxLength={MAX_TITLE_LENGTH}
          onChange={(e) => setTitle(e.target.value)}
        />

        <Input
          lbl={t('admin.quotes.sheet.validityDays')}
          type='number'
          min={MIN_VALIDITY_DAYS}
          max={MAX_VALIDITY_DAYS}
          value={validityDays}
          onChange={(e) => setValidityDays(e.target.value)}
        />

        <Seperator className='my-0' />

        <QuoteTemplateItemsEditor items={items} onChange={setItems} />

        <Seperator className='my-0' />

        <Input
          as='textarea'
          lbl={t('admin.quotes.sheet.intro')}
          required={false}
          rows={3}
          value={introText}
          onChange={(e) => setIntroText(e.target.value)}
        />
        <Input
          as='textarea'
          lbl={t('admin.quotes.sheet.terms')}
          required={false}
          rows={3}
          value={termsText}
          onChange={(e) => setTermsText(e.target.value)}
        />

        <div className='grid gap-2'>
          {proLocked ? (
            <SubscriptionExpiredState
              mode='inline'
              source='quote_template_save'
              feature={t('admin.quotes.expiredFeature')}
              translated
            />
          ) : (
            <Btn
              lbl={pending ? t('admin.quotes.sheet.saving') : draft.id ? t('admin.quotes.sheet.saveChanges') : t('admin.quotes.sheet.saveNew')}
              icon={pending ? 'spinner' : 'floppy-disk'}
              iconClassName={pending ? 'animate-spin' : undefined}
              disabled={pending}
              className='w-full'
              onClick={save}
            />
          )}
          {error && (
            <p className='text-sm text-red-600 ms-1' role='alert'>
              {error}
            </p>
          )}
        </div>
      </div>
    </ModalPop>
  )
}
