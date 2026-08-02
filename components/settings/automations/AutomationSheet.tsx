'use client'

import { useRef, useState, useTransition } from 'react'
import ModalPop from '@/lib/modals/ModalPop'
import { Btn } from '@/lib/btns/Btn'
import { Input, Select } from '@/lib/form'
import { Seperator } from '@/lib/Seperator'
import { toast } from '@/lib/toast'
import { AUTOMATION_EMAIL_VARIABLES, substituteVariables } from '@/lib/automations/variables'
import { TIMING_ACCURACY_COPY } from '@/lib/automations/copy'
import type { Timing } from '@/lib/automations/timing'
import type { TriggerType } from '@/lib/automations/types'
import { createAutomation, updateAutomation, type AutomationInput } from '@/actions/automations/manage'
import { SOURCES, STATUSES, TIMINGS, TRIGGERS, errorMessage as msg, timingKey } from './sheetOptions'
import { sendTestEmail } from '@/actions/automations/sendTest'

/**
 * Creation/edit in ONE sheet with three decisions (spec §5): כש… / שלח… /
 * מתי…. No wizard, no separate review step — the preview and the test send
 * are the review.
 */

export type SheetDraft = {
  id?: number
  name: string
  recipeKey: string | null
  trigger: TriggerType
  sourceFilter: string | null
  targetStatus: string | null
  subject: string
  body: string
  timing: Timing
}

export default function AutomationSheet({
  draft,
  previewName,
  onClose,
  onSaved,
}: {
  draft: SheetDraft
  previewName: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(draft.name)
  const [trigger, setTrigger] = useState<TriggerType>(draft.trigger)
  const [sourceFilter, setSourceFilter] = useState(draft.sourceFilter ?? '')
  const [targetStatus, setTargetStatus] = useState(draft.targetStatus ?? 'closed')
  const [subject, setSubject] = useState(draft.subject)
  const [body, setBody] = useState(draft.body)
  const [timing, setTiming] = useState<Timing>(draft.timing)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [testing, startTest] = useTransition()

  // Input renders either an input or a textarea, so its ref accepts both.
  const subjectRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const bodyRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const lastFocused = useRef<'subject' | 'body'>('body')

  function insertToken(token: string) {
    const target = lastFocused.current
    const el = target === 'subject' ? subjectRef.current : bodyRef.current
    const value = target === 'subject' ? subject : body
    const set = target === 'subject' ? setSubject : setBody
    const at = el?.selectionStart ?? value.length
    set(`${value.slice(0, at)}{{${token}}}${value.slice(at)}`)
    queueMicrotask(() => el?.focus())
  }

  function payload(): AutomationInput {
    return {
      name,
      recipeKey: draft.recipeKey,
      trigger,
      targetStatus: trigger === 'status_changed' ? targetStatus : null,
      sourceFilter: trigger === 'lead_created' ? sourceFilter || null : null,
      subject,
      body,
      timing,
    }
  }

  function save() {
    setError(null)
    startTransition(async () => {
      const res = draft.id ? await updateAutomation(draft.id, payload()) : await createAutomation(payload())
      if (res.ok === false) return setError(msg(res.reason))
      toast('success', draft.id ? 'האוטומציה עודכנה' : 'האוטומציה נשמרה כטיוטה')
      onSaved()
    })
  }

  function test() {
    setError(null)
    startTest(async () => {
      const res = await sendTestEmail({ subject, body })
      if (res.ok === false) return setError(msg(res.reason))
      toast('success', 'אימייל הבדיקה נשלח אליך')
    })
  }

  // Preview uses the SAME substitution the real send uses — a preview that
  // rendered differently would be a lie.
  const previewVars = { leadFirstName: previewName, businessName: null, repName: null }
  const previewSubject = substituteVariables(subject, previewVars)
  const previewBody = substituteVariables(body, previewVars)

  return (
    <ModalPop open onClose={onClose} pos='top' label={draft.id ? 'עריכת אוטומציה' : 'אוטומציה חדשה'}>
      <div className='grid gap-5 w-[min(90vw,560px)] pt-2'>
        <h2 className='text-lg font-semibold text-gray-800'>{draft.id ? 'עריכת אוטומציה' : 'אוטומציה חדשה'}</h2>

        <Input lbl='שם האוטומציה' value={name} onChange={(e) => setName(e.target.value)} placeholder='אימייל פתיחה לליד חדש' />

        <Seperator className='my-0' />

        <section className='grid gap-3'>
          <h3 className='text-sm font-semibold text-gray-800'>מתי זה קורה</h3>
          <Select
            lbl='הפעלה'
            options={TRIGGERS}
            value={trigger}
            onChange={(e) => setTrigger(e.target.value as TriggerType)}
          />
          {trigger === 'lead_created' ? (
            <Select lbl='מקור הליד' options={SOURCES} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} required={false} />
          ) : (
            <Select lbl='הסטטוס החדש' options={STATUSES} value={targetStatus} onChange={(e) => setTargetStatus(e.target.value)} />
          )}
        </section>

        <Seperator className='my-0' />

        <section className='grid gap-3'>
          <h3 className='text-sm font-semibold text-gray-800'>מה נשלח</h3>
          <Input
            ref={subjectRef}
            lbl='נושא האימייל'
            value={subject}
            onFocus={() => (lastFocused.current = 'subject')}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={120}
          />
          <Input
            ref={bodyRef}
            as='textarea'
            lbl='תוכן האימייל'
            value={body}
            rows={8}
            onFocus={() => (lastFocused.current = 'body')}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className='flex flex-wrap items-center gap-2'>
            <span className='text-sm text-gray-500'>הוספת פרטים:</span>
            {AUTOMATION_EMAIL_VARIABLES.map((v) => (
              <Btn key={v.token} variant='outline' size='small' lbl={v.token} onClick={() => insertToken(v.token)} />
            ))}
          </div>
        </section>

        <Seperator className='my-0' />

        <section className='grid gap-3'>
          <h3 className='text-sm font-semibold text-gray-800'>מתי לשלוח</h3>
          <div className='flex flex-wrap gap-2'>
            {TIMINGS.map((t) => (
              <Btn
                key={t.key}
                variant={timingKey(timing) === t.key ? 'solid' : 'outline'}
                size='small'
                lbl={t.lbl}
                onClick={() => setTiming(t.timing)}
              />
            ))}
          </div>
          <p className='text-sm text-gray-500 ms-1'>{TIMING_ACCURACY_COPY}</p>
        </section>

        <Seperator className='my-0' />

        <section className='grid gap-2'>
          <h3 className='text-sm font-semibold text-gray-800'>כך זה ייראה{previewName ? ` אצל ${previewName}` : ''}</h3>
          <div className='border rounded-md bg-gray-50 p-4 grid gap-2'>
            <p className='text-sm font-semibold text-gray-800'>{previewSubject || 'ללא נושא'}</p>
            <p className='text-sm text-gray-600 whitespace-pre-line'>{previewBody || 'ללא תוכן'}</p>
          </div>
        </section>

        <div className='grid gap-2'>
          <Btn
            lbl={pending ? 'שומר…' : draft.id ? 'שמור שינויים' : 'שמור אוטומציה'}
            icon={pending ? 'spinner' : 'floppy-disk'}
            iconClassName={pending ? 'animate-spin' : undefined}
            disabled={pending || testing}
            className='w-full'
            onClick={save}
          />
          <Btn
            variant='outline'
            lbl={testing ? 'שולח…' : 'שלח אליי אימייל בדיקה'}
            icon={testing ? 'spinner' : 'paper-plane'}
            iconClassName={testing ? 'animate-spin' : undefined}
            disabled={pending || testing}
            className='w-full'
            onClick={test}
          />
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
