'use client'

import { type RefObject } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { Input } from '@/lib/form'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * The authored content of an automation: subject, body, variable chips, and the
 * optional CTA block.
 *
 * Extracted from AutomationSheet, which was already at the file-size soft limit
 * before this section grew (architecture-rules §1/§8: the touch is the trigger).
 * The sheet stays the orchestrator; this owns one concern — what the customer
 * writes.
 *
 * The CTA is ONE optional block, not two extra fields. It is added and removed
 * as a unit, and while absent it does not exist: no empty inputs, no reserved
 * space, nothing to fill in by accident. That is the product model; where the
 * values are stored is the renderer's business.
 */

export type CtaDraft = { label: string; url: string }

export default function AutomationContentSection({
  title,
  subject,
  body,
  cta,
  chips,
  subjectRef,
  bodyRef,
  onFocusField,
  onSubjectChange,
  onBodyChange,
  onCtaChange,
  onInsertToken,
}: {
  title: string
  subject: string
  body: string
  /** Null means the block is not part of this email. */
  cta: CtaDraft | null
  /** `token` is what is inserted (and stored); `label` what the chip says (default: the token). */
  chips: readonly { token: string; field: string; label?: string }[]
  subjectRef: RefObject<(HTMLInputElement & HTMLTextAreaElement) | null>
  bodyRef: RefObject<(HTMLInputElement & HTMLTextAreaElement) | null>
  onFocusField: (field: 'subject' | 'body') => void
  onSubjectChange: (value: string) => void
  onBodyChange: (value: string) => void
  onCtaChange: (next: CtaDraft | null) => void
  onInsertToken: (token: string) => void
}) {
  const t = useT()
  return (
    <section className='grid gap-3'>
      <h3 className='text-sm font-semibold text-gray-800'>{title}</h3>

      <Input
        ref={subjectRef}
        lbl={t('admin.automationCatalog.param.subject')}
        value={subject}
        onFocus={() => onFocusField('subject')}
        onChange={(e) => onSubjectChange(e.target.value)}
        maxLength={120}
      />

      <Input
        ref={bodyRef}
        as='textarea'
        lbl={t('admin.automationCatalog.param.body')}
        value={body}
        rows={8}
        onFocus={() => onFocusField('body')}
        onChange={(e) => onBodyChange(e.target.value)}
      />

      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-sm text-gray-500'>{t('admin.automationSheet.content.insert')}</span>
        {chips.map((c) => (
          <Btn key={c.field} variant='outline' size='small' lbl={c.label ?? c.token} onClick={() => onInsertToken(c.token)} />
        ))}
      </div>

      {cta ? (
        <div className='grid gap-3 rounded-md border border-gray-200 p-3'>
          <div className='flex items-center justify-between gap-2'>
            <h4 className='text-sm font-semibold text-gray-800'>{t('admin.automationSheet.content.ctaHeading')}</h4>
            <Btn variant='ghost' size='small' lbl={t('admin.automationSheet.content.ctaRemove')} onClick={() => onCtaChange(null)} />
          </div>
          <Input
            lbl={t('admin.automationCatalog.param.ctaLabel.label')}
            value={cta.label}
            maxLength={40}
            onChange={(e) => onCtaChange({ ...cta, label: e.target.value })}
          />
          <Input
            lbl={t('admin.automationCatalog.param.ctaUrl')}
            value={cta.url}
            placeholder='https://'
            info={t('admin.automationSheet.content.ctaInfo')}
            onChange={(e) => onCtaChange({ ...cta, url: e.target.value })}
          />
        </div>
      ) : (
        <div>
          <Btn
            variant='outline'
            size='small'
            lbl={t('admin.automationSheet.content.ctaAdd')}
            onClick={() => onCtaChange({ label: '', url: '' })}
          />
        </div>
      )}
    </section>
  )
}
