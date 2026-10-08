'use client'

import { useState } from 'react'
import type { EditorIssue, EditorView } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import type { BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import type { ConfirmRequest } from '../builderCopy'
import QuestionnaireSimulator from '../QuestionnaireSimulator'
import WhatsAppPreview from '../WhatsAppPreview'
import FlowCanvas from './FlowCanvas'
import { keyOf, reactKey } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'

type Edit = (change: (m: BuilderQuestionnaire) => BuilderQuestionnaire) => void
export type FlowPanel = 'none' | 'preview' | 'test'

/**
 * The Flow view's screen: the map, and beside it on request either "how will
 * this look to the customer?" (the production preview) or the test chat (the
 * production simulator). The map explains structure; those two show words.
 */
export default function FlowWorkspace({
  model,
  view,
  edit,
  confirm,
  announce,
  issuesFor,
  leave,
  panel,
  setPanel,
  draftId,
  flush,
  onNotReady,
  openConversation,
}: {
  model: BuilderQuestionnaire
  view: EditorView
  edit: Edit
  confirm: (request: ConfirmRequest) => void
  announce: (message: string) => void
  issuesFor: (part: string) => EditorIssue[]
  leave: (part: string) => void
  panel: FlowPanel
  setPanel: (panel: FlowPanel) => void
  draftId: number | null
  flush: () => Promise<boolean>
  /** The test refused an unfinished draft: reveal every problem. */
  onNotReady: () => void
  openConversation: () => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const side = panel !== 'none'
  const selectedQuestion = selected ? model.questions.find((q) => reactKey(q) === selected) : undefined

  return (
    <div className={`grid gap-4 ${side ? 'min-[1200px]:grid-cols-[minmax(0,1fr)_380px]' : ''}`}>
      <FlowCanvas
        model={model}
        view={view}
        edit={edit}
        confirm={confirm}
        announce={announce}
        issuesFor={issuesFor}
        leave={leave}
        select={setSelected}
        selectedKey={selected}
        openConversation={openConversation}
      />
      {side && (
        <aside className='min-w-0 self-start'>
          {panel === 'test' && draftId !== null ? (
            <QuestionnaireSimulator model={model} target={{ draftId }} prepare={flush} onClose={() => setPanel('none')} onNotReady={onNotReady} autoFocus />
          ) : (
            <div className='grid gap-2'>
              <WhatsAppPreview
                model={model}
                view={view}
                focus={selectedQuestion ? { kind: 'question', key: keyOf(selectedQuestion) } : null}
              />
              <button type='button' onClick={() => setPanel('none')} className='justify-self-start text-sm text-gray-600 underline underline-offset-2'>
                סגירת התצוגה
              </button>
            </div>
          )}
        </aside>
      )}
    </div>
  )
}
