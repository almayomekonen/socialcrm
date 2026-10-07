'use client'

import { useId, useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import {
  addEnding,
  conditionSources,
  keyOf,
  moveEnding,
  removeEnding,
  updateEnding,
} from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import type { EditorIssue } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import type { BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import AutoResponseTextField from '@/components/settings/autoResponse/AutoResponseTextField'
import { describeCondition } from '@/lib/inbox/autoresponse/questionnaire/builder/conditionText'
import ConditionEditor from './ConditionEditor'
import LimitedButton from './LimitedButton'
import { rowsFor, type ConfirmRequest } from './builderCopy'

type Edit = (change: (m: BuilderQuestionnaire) => BuilderQuestionnaire) => void

/**
 * How the conversation ends. One standard ending, and "סיום שונה לפי תשובה":
 * an ending sent instead of it after a given answer (a wedding gets the
 * wedding link). Checked from the top; the first that matches is sent, so the
 * order is editable and said on screen.
 */
export default function EndingsSection({
  model,
  edit,
  endingIssues,
  standardIssues,
  confirm,
  onFocusEnding,
}: {
  model: BuilderQuestionnaire
  edit: Edit
  endingIssues: Record<number, EditorIssue[]>
  standardIssues: EditorIssue[]
  confirm: (request: ConfirmRequest) => void
  onFocusEnding: (index: number) => void
}) {
  const id = useId()
  const [editing, setEditing] = useState<number | null>(null)
  const sources = conditionSources(model, '')
  const custom = model.endings.custom

  return (
    <section
      id='questionnaire-endings'
      aria-labelledby={`${id}-title`}
      className='grid scroll-mt-24 gap-4 rounded-lg border border-gray-200 bg-white p-5'
    >
      <div>
        <h2 id={`${id}-title`} className='text-base font-semibold text-ink'>
          סיום השיחה
        </h2>
        <p className='mt-1 text-sm text-gray-600'>ההודעה שהלקוח מקבל אחרי השאלה האחרונה.</p>
      </div>

      <div onFocusCapture={() => onFocusEnding(-1)}>
        <AutoResponseTextField
          id={`${id}-standard`}
          label='הודעת הסיום'
          hint='נשלחת לכל מי שסיים, אלא אם הוגדר לו סיום שונה'
          value={model.endings.standard}
          onChange={(v) => edit((m) => ({ ...m, endings: { ...m.endings, standard: v } }))}
          placeholder='למשל: מעולה, קיבלנו את הפרטים. נחזור אליכם בהקדם.'
          maxLength={900}
          sent
          rows={rowsFor(model.endings.standard, 3)}
          error={standardIssues[0]?.text}
        />
      </div>

      <div className='grid gap-3'>
        <h3 className='text-sm font-semibold text-gray-700'>סיום שונה לפי תשובה</h3>
        {custom.length > 1 && <p className='text-xs text-gray-500'>נבדק מלמעלה למטה. הלקוח מקבל את הסיום הראשון שמתאים לו.</p>}

        {custom.map((ending, index) => {
          const condition = ending.sentWhen.conditions[0] ?? null
          const issues = endingIssues[index] ?? []
          return (
            <div
              key={index}
              onFocusCapture={() => onFocusEnding(index)}
              className={`grid gap-3 rounded-md border p-3 ${issues.length ? 'border-red-300' : 'border-gray-200'}`}
            >
              <div className='flex items-center justify-between gap-2'>
                <p className='text-sm font-medium text-gray-800'>סיום שונה {index + 1}</p>
                <div className='flex items-center gap-1'>
                  <Btn
                    type='button'
                    size='small'
                    variant='ghost'
                    icon='arrow-up'
                    aria-label={`העברת סיום שונה ${index + 1} למעלה`}
                    onClick={() => edit((m) => moveEnding(m, index, -1))}
                    disabled={index === 0}
                  />
                  <Btn
                    type='button'
                    size='small'
                    variant='ghost'
                    icon='arrow-down'
                    aria-label={`העברת סיום שונה ${index + 1} למטה`}
                    onClick={() => edit((m) => moveEnding(m, index, 1))}
                    disabled={index === custom.length - 1}
                  />
                  <Btn
                    type='button'
                    size='small'
                    variant='ghost'
                    icon='trash'
                    aria-label={`מחיקת סיום שונה ${index + 1}`}
                    onClick={() =>
                      confirm({
                        msg: `למחוק את סיום שונה ${index + 1}?`,
                        confirmLbl: 'מחיקת הסיום',
                        destructive: true,
                        run: () => edit((m) => removeEnding(m, index)),
                      })
                    }
                  />
                </div>
              </div>
              {/* The rule reads as a sentence; the picker opens on request, or while no answer is ticked. */}
              {editing === index || !condition?.anyOf.length ? (
                <div className='grid gap-2'>
                  <ConditionEditor
                    model={model}
                    sources={sources}
                    condition={condition}
                    onChange={(c) => c && edit((m) => updateEnding(m, index, { condition: c }))}
                    allowAlways={false}
                    legend='מתי נשלח הסיום הזה'
                    sentencePrefix='נשלח כאשר:'
                  />
                  {condition?.anyOf.length ? (
                    <div>
                      <button
                        type='button'
                        onClick={() => setEditing(null)}
                        className='text-sm font-medium text-ink underline underline-offset-2'
                      >
                        סיום
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className='flex flex-wrap items-baseline gap-x-2 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-800'>
                  <span>
                    <span className='font-medium'>נשלח כאשר:</span> {describeCondition(model, condition)}
                  </span>
                  <button
                    type='button'
                    onClick={() => setEditing(index)}
                    className='text-xs text-gray-600 underline underline-offset-2'
                  >
                    שינוי
                  </button>
                </p>
              )}
              <AutoResponseTextField
                id={`${id}-custom-${index}`}
                label='ההודעה'
                hint='למשל הודעת הסיום עם קישור מתאים'
                value={ending.message}
                onChange={(v) => edit((m) => updateEnding(m, index, { message: v }))}
                placeholder=''
                maxLength={900}
                sent
                rows={rowsFor(ending.message, 3)}
              />
              {issues.length > 0 && (
                <ul className='grid gap-1'>
                  {issues.map((i, n) => (
                    <li key={n} className='text-sm text-red-700'>
                      {i.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}

        <div>
          <LimitedButton
            size='small'
            variant='outline'
            icon='plus'
            lbl='הוספת סיום שונה לפי תשובה'
            blockedReason={
              !sources.length
                ? 'כדי לשלוח סיום שונה לפי תשובה, צריכה להיות בשאלון שאלה עם אפשרויות לבחירה.'
                : custom.length >= 10
                  ? 'אפשר עד 10 סיומים שונים.'
                  : null
            }
            onClick={() => edit((m) => addEnding(m, { questionId: keyOf(sources[0]), anyOf: [] }))}
          />
        </div>
      </div>
    </section>
  )
}
