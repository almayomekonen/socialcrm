'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useState } from 'react'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { useQuestionnaireDraft } from '@/hooks/useQuestionnaireDraft'
import { useQuestionnaireRelease } from '@/hooks/useQuestionnaireRelease'
import { deriveEditorView } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import type { DraftState } from '@/lib/inbox/autoresponse/questionnaire/builder/draftState'
import BuilderHeader, { type LiveRouting } from './BuilderHeader'
import { isAnswering, publishConfirmText, type ConfirmRequest } from './builderCopy'
import BuilderAlerts from './BuilderAlerts'
import { focusCard } from './focusCard'
import ConversationWorkspace from './ConversationWorkspace'
import type { FlowPanel } from './flow/FlowWorkspace'
import RevisionHistory from './RevisionHistory'

// The canvas library loads only when the Flow view is opened.
const FlowWorkspace = dynamic(() => import('./flow/FlowWorkspace'), {
  ssr: false,
  loading: () => <p className='text-sm text-gray-500'>טוען את מפת השאלון…</p>,
})

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
  flowEnabled = false,
}: {
  initialDraft: DraftState | null
  liveRevision: number | null
  routing: LiveRouting
  /** The Flow view prototype (QUESTIONNAIRE_FLOW_EDITOR=1); absent, only the Conversation view exists. */
  flowEnabled?: boolean
}) {
  const draft = useQuestionnaireDraft(initialDraft)
  const release = useQuestionnaireRelease(draft, initialLive)
  const [panel, setPanel] = useState<'preview' | 'test'>('preview')
  const [mode, setMode] = useState<'flow' | 'conversation'>(flowEnabled ? 'flow' : 'conversation')
  const [flowPanel, setFlowPanel] = useState<FlowPanel>('none')
  // The question being worked on in the map: the list opens on it.
  const [flowSelection, setFlowSelection] = useState<string | null>(null)
  const switchTo = (next: 'flow' | 'conversation') => {
    setMode(next)
    if (next === 'conversation' && flowSelection) setTimeout(() => focusCard(flowSelection), 50)
  }
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
  const blocked = release.state.kind === 'blocked'
  useEffect(() => {
    if (blocked) setRevealLatched(true)
  }, [blocked])
  // Same render as the refusal: the problems list and the marked cards appear together.
  const revealAll = revealLatched || blocked
  // Flow boxes read problems by part: a question key, or 'opening' / 'endings' (questionnaire-wide ones).
  const issuesFor = (part: string) =>
    !view || !(revealAll || touched.has(part)) ? [] : part === 'opening' || part === 'endings' ? (view.issues[''] ?? []) : (view.issues[part] ?? [])
  const testing = mode === 'flow' ? flowPanel === 'test' : panel === 'test'
  const toggleTest = () =>
    mode === 'flow' ? setFlowPanel((p) => (p === 'test' ? 'none' : 'test')) : setPanel((p) => (p === 'test' ? 'preview' : 'test'))

  const restore = (revision: number) =>
    setConfirmRequest({
      msg: `ליצור טיוטה מגרסה ${revision}?\nהטיוטה הנוכחית תוחלף, ושינויים בה שלא פורסמו יימחקו. הגרסה תפורסם רק כשתלחצו על פרסום.`,
      confirmLbl: `יצירת טיוטה מגרסה ${revision}`,
      run: () => {
        setHistoryOpen(false)
        setPanel('preview')
        setFlowPanel('none')
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
        testing={testing}
        onTest={toggleTest}
        onPreview={mode === 'flow' ? () => setFlowPanel((p) => (p === 'preview' ? 'none' : 'preview')) : undefined}
        previewing={mode === 'flow' && flowPanel === 'preview'}
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
          {flowEnabled && (
            <div role='tablist' aria-label='תצוגת העריכה' className='hidden w-fit rounded-lg border border-gray-200 bg-white p-1 desktop:flex'>
              {(
                [
                  ['flow', 'תרשים'],
                  ['conversation', 'רשימה'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type='button'
                  role='tab'
                  aria-selected={mode === value}
                  onClick={() => switchTo(value)}
                  className={`rounded-md px-4 py-1.5 text-sm ${mode === value ? 'bg-solid text-white' : 'text-gray-700 hover:bg-gray-100'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {mode === 'flow' ? (
            <div>
              <FlowWorkspace
                model={model}
                view={view}
                edit={edit}
                confirm={setConfirmRequest}
                announce={setAnnouncement}
                issuesFor={issuesFor}
                leave={touch}
                panel={flowPanel}
                setPanel={setFlowPanel}
                draftId={draft.meta?.draftId ?? null}
                flush={draft.flush}
                onNotReady={() => setRevealLatched(true)}
                openConversation={() => switchTo('conversation')}
                onSelectQuestion={setFlowSelection}
              />
            </div>
          ) : (
            <ConversationWorkspace
              model={model}
              view={view}
              edit={edit}
              canEdit={canEdit}
              revealAll={revealAll}
              touched={touched}
              touch={touch}
              confirm={setConfirmRequest}
              announce={setAnnouncement}
              testing={panel === 'test'}
              stopTesting={() => setPanel('preview')}
              draftId={draft.meta?.draftId ?? null}
              flush={draft.flush}
              onNotReady={() => setRevealLatched(true)}
            />
          )}
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
