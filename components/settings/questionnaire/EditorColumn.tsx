'use client'

import AutoResponseTextField from '@/components/settings/autoResponse/AutoResponseTextField'
import { addQuestion, keyOf, questionsFull, reactKey } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import type { EditorIssue, EditorView } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import type { BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import { QUESTIONS_FULL, rowsFor, type ConfirmRequest } from './builderCopy'
import EndingsSection from './EndingsSection'
import ExtraMessages from './ExtraMessages'
import LimitedButton from './LimitedButton'
import QuestionCard from './QuestionCard'
import type { PreviewFocus } from './WhatsAppPreview'

type Edit = (change: (m: BuilderQuestionnaire) => BuilderQuestionnaire) => void

/**
 * The conversation, top to bottom: opening, questions, ending, the rarely
 * changed messages.
 *
 * Problems are shown where the owner has already been: a part's issues appear
 * once focus has left it, or everywhere after a publish attempt (`revealAll`).
 * A fresh question is a blank to fill in, not a wall of red.
 */
export default function EditorColumn({
  model,
  view,
  edit,
  canEdit,
  revealAll,
  touched,
  onLeave,
  onFocus,
  confirm,
  announce,
}: {
  model: BuilderQuestionnaire
  view: EditorView
  edit: Edit
  canEdit: boolean
  revealAll: boolean
  touched: ReadonlySet<string>
  onLeave: (part: string) => void
  onFocus: (focus: PreviewFocus) => void
  confirm: (request: ConfirmRequest) => void
  announce: (message: string) => void
}) {
  const shown = (part: string, issues: EditorIssue[] | undefined) => (revealAll || touched.has(part) ? (issues ?? []) : [])
  const general = view.issues[''] ?? []
  const leave = (part: string) => (e: React.FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onLeave(part)
  }

  return (
    <fieldset disabled={!canEdit} className='hidden min-w-0 gap-5 desktop:grid'>
      <legend className='sr-only'>עריכת השאלון</legend>
      <section
        className='rounded-lg border border-gray-200 bg-white p-5'
        onFocusCapture={() => onFocus(null)}
        onBlurCapture={leave('opening')}
      >
        <AutoResponseTextField
          id='questionnaire-opening'
          label='הודעת הפתיחה'
          hint='נשלחת ללקוח בהודעה הראשונה, יחד עם השאלה הראשונה'
          value={model.opening}
          onChange={(v) => edit((m) => ({ ...m, opening: v }))}
          placeholder='למשל: היי, תודה שפניתם אלינו.'
          maxLength={900}
          sent
          rows={rowsFor(model.opening, 3)}
          error={shown('opening', general).find((i) => i.field === 'opening')?.text}
        />
      </section>

      <section aria-labelledby='questionnaire-questions' className='grid gap-4'>
        <h2 id='questionnaire-questions' className='text-base font-semibold text-ink'>
          השאלות
        </h2>
        {model.questions.map((q, index) => (
          <QuestionCard
            key={reactKey(q)}
            model={model}
            question={q}
            index={index}
            issues={shown(keyOf(q), view.issues[keyOf(q)])}
            edit={edit}
            confirm={confirm}
            onFocus={() => onFocus({ kind: 'question', key: keyOf(q) })}
            onLeave={() => onLeave(keyOf(q))}
            announce={announce}
          />
        ))}
        {model.questions.length === 0 && <p className='text-sm text-gray-600'>אין עדיין שאלות. הוסיפו את השאלה הראשונה.</p>}
        <div>
          <LimitedButton
            variant='outline'
            icon='plus'
            lbl='הוספת שאלה'
            blockedReason={questionsFull(model) ? QUESTIONS_FULL : null}
            onClick={() => {
              edit(addQuestion)
              announce('נוספה שאלה חדשה בסוף הרשימה')
            }}
          />
        </div>
      </section>

      <div onBlurCapture={leave('endings')}>
        <EndingsSection
          model={model}
          edit={edit}
          endingIssues={revealAll || touched.has('endings') ? view.endingIssues : {}}
          standardIssues={shown('endings', general).filter((i) => i.field === 'standardEnding')}
          confirm={confirm}
          onFocusEnding={(index) => onFocus(index < 0 ? null : { kind: 'ending', index })}
        />
      </div>
      <div onBlurCapture={leave('extra')}>
        <ExtraMessages model={model} edit={edit} issues={shown('extra', general)} />
      </div>
    </fieldset>
  )
}
