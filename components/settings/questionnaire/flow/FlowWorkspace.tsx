'use client'

import { useEffect, useRef, useState } from 'react'
import type { EditorIssue, EditorView } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import type { BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import type { ConfirmRequest } from '../builderCopy'
import QuestionnaireSimulator from '../QuestionnaireSimulator'
import WhatsAppPreview from '../WhatsAppPreview'
import FlowCanvas from './FlowCanvas'
import { addPhrasing, keyOf, reactKey } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import { useT } from '@/lib/i18n/I18nProvider'
import { dirFor } from '@/lib/i18n/config'

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
  onSelectQuestion,
  allowAllEnabled = false,
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
  /** The question being worked on (render key), so switching to the list can land on it. */
  onSelectQuestion?: (questionReactKey: string | null) => void
  /** "לקוח יכול לענות 'הכל'", decided on the server (canUseQuestionnaireNaturalAnswers): shown only where it has an effect. */
  allowAllEnabled?: boolean
}) {
  const t = useT()
  // The drawer opens over the END of the map: its left edge in a right-to-left interface, its right edge otherwise.
  const edge = dirFor(t.locale) === 'rtl' ? 'desktop:left-0' : 'desktop:right-0'
  const [selected, setSelected] = useState<string | null>(null)
  const select = (nodeId: string | null) => {
    setSelected(nodeId)
    const q = nodeId ? model.questions.find((x) => reactKey(x) === nodeId) : undefined
    onSelectQuestion?.(q ? reactKey(q) : null)
  }
  const side = panel !== 'none'
  // Closing the panel returns the cursor to what opened it ("בדיקת השאלון" / "איך זה ייראה ללקוח?").
  // The drawer's own autofocus moves the cursor before effects run, so the
  // opener is the last element focused OUTSIDE the drawer.
  const opener = useRef<HTMLElement | null>(null)
  const drawer = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const track = (e: FocusEvent) => {
      const t = e.target as HTMLElement
      if (!drawer.current?.contains(t)) opener.current = t
    }
    document.addEventListener('focusin', track)
    return () => document.removeEventListener('focusin', track)
  }, [])
  const closePanel = () => {
    setPanel('none')
    requestAnimationFrame(() => opener.current?.focus?.())
  }
  const selectedQuestion = selected ? model.questions.find((q) => reactKey(q) === selected) : undefined

  return (
    // The map keeps its full width. From 1200px preview and test open as a
    // drawer over its left edge (the end of a right-to-left page); 1000-1199px
    // they cover the map until closed; below 1000px they are the page. Escape
    // or "סגירה וחזרה לתרשים" always returns to the whole map.
    <div className='relative'>
      {/* Below 1000px the map is not offered (desk work); test and preview still are. */}
      <div className='hidden desktop:block'>
        <FlowCanvas
          model={model}
          view={view}
          edit={edit}
          confirm={confirm}
          announce={announce}
          issuesFor={issuesFor}
          leave={leave}
          select={select}
          selectedKey={selected}
          openConversation={openConversation}
          allowAllEnabled={allowAllEnabled}
        />
      </div>
      {side && (
        <aside
          ref={drawer}
          aria-label={panel === 'test' ? t('admin.questionnaire.header.test') : t('admin.questionnaireFlow.drawer.preview')}
          onKeyDown={(e) => e.key === 'Escape' && closePanel()}
          className={`flex w-full flex-col gap-2 rounded-lg border border-gray-200 bg-white p-4 desktop:absolute desktop:inset-y-0 ${edge} desktop:z-10 desktop:overflow-y-auto desktop:shadow-xl min-[1200px]:w-[400px] min-[1200px]:rounded-e-none`}
        >
          <button
            type='button'
            onClick={closePanel}
            className='self-end text-sm text-gray-600 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-primary'
          >
            {t('admin.questionnaireFlow.drawer.close')}<span className='hidden desktop:inline'>{t('admin.questionnaireFlow.drawer.closeToMap')}</span>
          </button>
          {panel === 'test' && draftId !== null ? (
            <QuestionnaireSimulator
              model={model}
              target={{ draftId }}
              prepare={flush}
              onNotReady={onNotReady}
              onTeach={(t) => edit((m) => addPhrasing(m, t.questionId, t.optionId, t.phrase))}
              autoFocus
              translated
            />
          ) : (
            <WhatsAppPreview model={model} view={view} focus={selectedQuestion ? { kind: 'question', key: keyOf(selectedQuestion) } : null} />
          )}
        </aside>
      )}
    </div>
  )
}
