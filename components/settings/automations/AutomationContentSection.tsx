'use client'

import { type RefObject } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { Input } from '@/lib/form'

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
  chips: readonly { token: string; field: string }[]
  subjectRef: RefObject<(HTMLInputElement & HTMLTextAreaElement) | null>
  bodyRef: RefObject<(HTMLInputElement & HTMLTextAreaElement) | null>
  onFocusField: (field: 'subject' | 'body') => void
  onSubjectChange: (value: string) => void
  onBodyChange: (value: string) => void
  onCtaChange: (next: CtaDraft | null) => void
  onInsertToken: (token: string) => void
}) {
  return (
    <section className='grid gap-3'>
      <h3 className='text-sm font-semibold text-gray-800'>{title}</h3>

      <Input
        ref={subjectRef}
        lbl='נושא האימייל'
        value={subject}
        onFocus={() => onFocusField('subject')}
        onChange={(e) => onSubjectChange(e.target.value)}
        maxLength={120}
      />

      <Input
        ref={bodyRef}
        as='textarea'
        lbl='תוכן האימייל'
        value={body}
        rows={8}
        onFocus={() => onFocusField('body')}
        onChange={(e) => onBodyChange(e.target.value)}
      />

      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-sm text-gray-500'>הוספת פרטים:</span>
        {chips.map((c) => (
          <Btn key={c.field} variant='outline' size='small' lbl={c.token} onClick={() => onInsertToken(c.token)} />
        ))}
      </div>

      {cta ? (
        <div className='grid gap-3 rounded-md border border-gray-200 p-3'>
          <div className='flex items-center justify-between gap-2'>
            <h4 className='text-sm font-semibold text-gray-800'>כפתור בתוך האימייל</h4>
            <Btn variant='ghost' size='small' lbl='הסרת הכפתור' onClick={() => onCtaChange(null)} />
          </div>
          <Input
            lbl='טקסט הכפתור'
            value={cta.label}
            maxLength={40}
            onChange={(e) => onCtaChange({ ...cta, label: e.target.value })}
          />
          <Input
            lbl='קישור הכפתור'
            value={cta.url}
            placeholder='https://'
            info='הקישור חייב להתחיל ב-https://'
            onChange={(e) => onCtaChange({ ...cta, url: e.target.value })}
          />
        </div>
      ) : (
        <div>
          <Btn
            variant='outline'
            size='small'
            lbl='הוספת כפתור לאימייל'
            onClick={() => onCtaChange({ label: '', url: '' })}
          />
        </div>
      )}
    </section>
  )
}
