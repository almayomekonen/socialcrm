'use client'

import { useMemo, useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import AutoResponseTextField from '@/components/settings/autoResponse/AutoResponseTextField'
import { useQuestionnaireDraft } from '@/hooks/useQuestionnaireDraft'
import { useQuestionnaireRelease } from '@/hooks/useQuestionnaireRelease'
import { addQuestion, keyOf } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import { deriveEditorView } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import type { DraftState } from '@/lib/inbox/autoresponse/questionnaire/builder/draftState'
import BuilderHeader, { type LiveRouting } from './BuilderHeader'
import type { ConfirmRequest } from './builderCopy'
import BuilderAlerts from './BuilderAlerts'
import EndingsSection from './EndingsSection'
import QuestionCard from './QuestionCard'
import QuestionnaireSimulator from './QuestionnaireSimulator'
import RevisionHistory from './RevisionHistory'
import WhatsAppPreview, { type PreviewFocus } from './WhatsAppPreview'
import ExtraMessages from './ExtraMessages'

const MAX_QUESTIONS = 12

/**
 * The Questionnaire Builder: the conversation on the right, what WhatsApp will
 * show on the left. A thin orchestrator: the draft lifecycle lives in
 * useQuestionnaireDraft, publishing and restoring in useQuestionnaireRelease,
 * every model change in editorOps, every derived word in editorView.
 */
export default function QuestionnaireBuilder({
  initialDraft,
  liveRevision: initialLive,
  routing,
}: {
  initialDraft: DraftState | null
  liveRevision: number | null
  routing: LiveRouting
}) {
  const draft = useQuestionnaireDraft(initialDraft)
  const release = useQuestionnaireRelease(draft, initialLive)
  const [panel, setPanel] = useState<'preview' | 'test'>('preview')
  const [focus, setFocus] = useState<PreviewFocus>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const { model, edit } = draft
  const view = useMemo(() => (model ? deriveEditorView(model) : null), [model])
  const canEdit = draft.phase === 'ready'

  const restore = (revision: number) =>
    setConfirmRequest({
      msg: `ליצור טיוטה מגרסה ${revision}?\nהטיוטה הנוכחית תוחלף, ושינויים בה שלא פורסמו יימחקו. הגרסה תפורסם רק כשתלחצו על פרסום.`,
      confirmLbl: `יצירת טיוטה מגרסה ${revision}`,
      run: () => {
        setHistoryOpen(false)
        setPanel('preview')
        void release.restore(revision)
      },
    })

  const rs = release.state
  return (
    <div className='grid gap-6'>
      <BuilderHeader
        liveRevision={release.liveRevision}
        routing={routing}
        saveStatus={draft.saveStatus}
        canEdit={canEdit}
        testing={panel === 'test'}
        onTest={() => setPanel((p) => (p === 'test' ? 'preview' : 'test'))}
        onHistory={() => setHistoryOpen(true)}
        onPublish={() => void release.requestPublish()}
        publishBusy={rs.kind === 'checking' || rs.kind === 'publishing'}
      />
      <p className='sr-only' aria-live='polite'>
        {announcement}
      </p>

      <BuilderAlerts
        conflict={draft.phase === 'conflict' ? draft.conflict : null}
        failure={draft.phase === 'failed' ? (draft.failure ?? '') : null}
        release={rs}
        model={model}
        onDismiss={release.dismiss}
      />

      {draft.phase === 'opening' && <p className='text-sm text-gray-500'>פותח את השאלון…</p>}

      {model && view && (
        <>
          <p className='rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 desktop:hidden'>
            עריכת השאלון זמינה במסך רחב, במחשב. כאן אפשר לבדוק את השאלון ולראות את מצבו.
          </p>
          {/* One simulator and one preview, placed by the layout: below 1000px the
              editor is not offered (desk work), the test conversation is. */}
          <div className='grid gap-6 desktop:grid-cols-[minmax(0,1fr)_clamp(280px,34%,400px)]'>
            <fieldset disabled={!canEdit} className='hidden min-w-0 gap-5 desktop:grid'>
              <legend className='sr-only'>עריכת השאלון</legend>
              <section className='rounded-lg border border-gray-200 bg-white p-5' onFocusCapture={() => setFocus(null)}>
                <AutoResponseTextField
                  id='questionnaire-opening'
                  label='הודעת הפתיחה'
                  hint='נשלחת ללקוח בהודעה הראשונה, יחד עם השאלה הראשונה'
                  value={model.opening}
                  onChange={(v) => edit((m) => ({ ...m, opening: v }))}
                  placeholder='למשל: היי, תודה שפניתם אלינו.'
                  maxLength={900}
                  sent
                  error={view.issues['']?.find((i) => i.field === 'opening')?.text}
                />
              </section>

              <section aria-labelledby='questionnaire-questions' className='grid gap-4'>
                <h2 id='questionnaire-questions' className='text-base font-semibold text-ink'>
                  השאלות
                </h2>
                {model.questions.map((q, index) => (
                  <QuestionCard
                    key={keyOf(q)}
                    model={model}
                    question={q}
                    index={index}
                    issues={view.issues[keyOf(q)] ?? []}
                    edit={edit}
                    confirm={setConfirmRequest}
                    onFocus={() => setFocus({ kind: 'question', key: keyOf(q) })}
                    announce={setAnnouncement}
                  />
                ))}
                {view.issues['']?.some((i) => i.code === 'no_questions') && (
                  <p className='text-sm text-gray-600'>אין עדיין שאלות. הוסיפו את השאלה הראשונה.</p>
                )}
                <div>
                  <Btn
                    type='button'
                    variant='outline'
                    icon='plus'
                    lbl='הוספת שאלה'
                    onClick={() => {
                      edit(addQuestion)
                      setAnnouncement('נוספה שאלה חדשה בסוף הרשימה')
                    }}
                    disabled={model.questions.length >= MAX_QUESTIONS}
                    title={model.questions.length >= MAX_QUESTIONS ? 'אפשר עד 12 שאלות בשאלון' : undefined}
                  />
                </div>
              </section>

              <EndingsSection
                model={model}
                edit={edit}
                endingIssues={view.endingIssues}
                standardIssues={view.issues['']?.filter((i) => i.field === 'standardEnding') ?? []}
                confirm={setConfirmRequest}
                onFocusEnding={(index) => setFocus(index < 0 ? null : { kind: 'ending', index })}
              />
              <ExtraMessages model={model} edit={edit} issues={view.issues[''] ?? []} />
            </fieldset>

            <aside className='min-w-0 self-start desktop:sticky desktop:top-4'>
              {panel === 'test' && draft.meta ? (
                <QuestionnaireSimulator
                  model={model}
                  target={{ draftId: draft.meta.draftId }}
                  prepare={draft.flush}
                  onClose={() => setPanel('preview')}
                  autoFocus
                />
              ) : (
                <div className='hidden desktop:block'>
                  <WhatsAppPreview model={model} view={view} focus={focus} />
                </div>
              )}
            </aside>
          </div>
        </>
      )}

      <RevisionHistory open={historyOpen} onClose={() => setHistoryOpen(false)} onRestore={restore} />
      <ConfirmPop
        open={rs.kind === 'confirm' || rs.kind === 'publishing'}
        onClose={release.dismiss}
        onConfirm={release.confirmPublish}
        msg={
          rs.kind === 'confirm'
            ? `לפרסם את השאלון כגרסה ${rs.nextRevision}?\nשיחות חדשות יקבלו את הגרסה הזו. שיחות שכבר התחילו ימשיכו בגרסה שבה התחילו.`
            : 'מפרסם…'
        }
        confirmLbl={rs.kind === 'confirm' ? `פרסום גרסה ${rs.nextRevision}` : 'מפרסם…'}
      />
      <ConfirmPop
        open={confirmRequest !== null}
        onClose={() => setConfirmRequest(null)}
        onConfirm={() => {
          confirmRequest?.run()
          setConfirmRequest(null)
        }}
        msg={confirmRequest?.msg ?? ''}
        confirmLbl={confirmRequest?.confirmLbl}
        destructive={confirmRequest?.destructive}
      />
    </div>
  )
}
