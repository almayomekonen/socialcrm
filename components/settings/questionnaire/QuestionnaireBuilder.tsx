'use client'

import { useEffect, useMemo, useState } from 'react'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { useQuestionnaireDraft } from '@/hooks/useQuestionnaireDraft'
import { useQuestionnaireRelease } from '@/hooks/useQuestionnaireRelease'
import { deriveEditorView } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import type { DraftState } from '@/lib/inbox/autoresponse/questionnaire/builder/draftState'
import BuilderHeader, { type LiveRouting } from './BuilderHeader'
import { isAnswering, publishConfirmText, type ConfirmRequest } from './builderCopy'
import BuilderAlerts from './BuilderAlerts'
import EditorColumn from './EditorColumn'
import QuestionnaireSimulator from './QuestionnaireSimulator'
import RevisionHistory from './RevisionHistory'
import WhatsAppPreview, { type PreviewFocus } from './WhatsAppPreview'

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
  // Problems show where the owner has been, and everywhere once publishing was refused.
  const [revealLatched, setRevealLatched] = useState(false)
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set())
  const touch = (part: string) => setTouched((t) => (t.has(part) ? t : new Set([...t, part])))
  const [previewOpen, setPreviewOpen] = useState(false)
  const blocked = release.state.kind === 'blocked'
  useEffect(() => {
    if (blocked) setRevealLatched(true)
  }, [blocked])
  // Same render as the refusal: the problems list and the marked cards appear together.
  const revealAll = revealLatched || blocked

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
          {/* One simulator and one preview, placed by the layout. From 1200px the
              preview sits beside the editor; 1000-1199px gives the editor the
              full width and folds the preview behind a button; below 1000px the
              editor is not offered (desk work), the test conversation is. */}
          <div className='grid gap-6 min-[1200px]:grid-cols-[minmax(0,1fr)_clamp(300px,34%,400px)]'>
            <EditorColumn
              model={model}
              view={view}
              edit={edit}
              canEdit={canEdit}
              revealAll={revealAll}
              touched={touched}
              onLeave={touch}
              onFocus={setFocus}
              confirm={setConfirmRequest}
              announce={setAnnouncement}
            />

            <aside className='order-first min-w-0 self-start min-[1200px]:sticky min-[1200px]:top-4 min-[1200px]:order-none'>
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
                  <button
                    type='button'
                    aria-expanded={previewOpen}
                    onClick={() => setPreviewOpen((o) => !o)}
                    className='mb-3 text-sm font-medium text-ink underline underline-offset-2 min-[1200px]:hidden'
                  >
                    {previewOpen ? 'הסתרת מה הלקוח יקבל' : 'מה הלקוח יקבל? הצגת ההודעות'}
                  </button>
                  <div className={previewOpen ? '' : 'hidden min-[1200px]:block'}>
                    <WhatsAppPreview model={model} view={view} focus={focus} />
                  </div>
                </div>
              )}
            </aside>
          </div>
        </>
      )}

      <RevisionHistory
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onRestore={restore}
        answering={isAnswering(routing)}
      />
      <ConfirmPop
        open={rs.kind === 'confirm' || rs.kind === 'publishing'}
        onClose={release.dismiss}
        onConfirm={release.confirmPublish}
        msg={rs.kind === 'confirm' ? publishConfirmText(rs.nextRevision, routing) : 'מפרסם…'}
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
