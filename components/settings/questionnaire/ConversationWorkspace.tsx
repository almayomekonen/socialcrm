'use client'

import { useState } from 'react'
import type { EditorView } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import type { BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import type { ConfirmRequest } from './builderCopy'
import EditorColumn from './EditorColumn'
import { addPhrasing } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import QuestionnaireSimulator from './QuestionnaireSimulator'
import { useT } from '@/lib/i18n/I18nProvider'
import WhatsAppPreview, { type PreviewFocus } from './WhatsAppPreview'

type Edit = (change: (m: BuilderQuestionnaire) => BuilderQuestionnaire) => void

/**
 * The Conversation view (PR2): question cards on the right, the WhatsApp
 * preview or the test chat on the left. From 1200px the preview sits beside
 * the editor; 1000-1199px gives the editor the full width and folds the
 * preview behind a button; below 1000px the editor is not offered (desk
 * work), the test conversation is.
 */
export default function ConversationWorkspace({
  model,
  view,
  edit,
  canEdit,
  revealAll,
  touched,
  touch,
  confirm,
  announce,
  testing,
  stopTesting,
  draftId,
  flush,
  onNotReady,
  allowAllEnabled = false,
}: {
  model: BuilderQuestionnaire
  view: EditorView
  edit: Edit
  canEdit: boolean
  revealAll: boolean
  touched: ReadonlySet<string>
  touch: (part: string) => void
  confirm: (request: ConfirmRequest) => void
  announce: (message: string) => void
  testing: boolean
  stopTesting: () => void
  draftId: number | null
  flush: () => Promise<boolean>
  /** The test refused an unfinished draft: reveal every problem. */
  onNotReady: () => void
  /** "לקוח יכול לענות 'הכל'", decided on the server (canUseQuestionnaireNaturalAnswers): shown only where it has an effect. */
  allowAllEnabled?: boolean
}) {
  const t = useT()
  const [focus, setFocus] = useState<PreviewFocus>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  return (
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
        confirm={confirm}
        announce={announce}
        allowAllEnabled={allowAllEnabled}
      />
      <aside className='order-first min-w-0 self-start min-[1200px]:sticky min-[1200px]:top-4 min-[1200px]:order-none'>
        {testing && draftId !== null ? (
          <QuestionnaireSimulator model={model} target={{ draftId }} prepare={flush} onClose={stopTesting} onNotReady={onNotReady}
              onTeach={(t) => edit((m) => addPhrasing(m, t.questionId, t.optionId, t.phrase))}
              autoFocus
              translated
            />
        ) : (
          <div className='hidden desktop:block'>
            <button
              type='button'
              aria-expanded={previewOpen}
              onClick={() => setPreviewOpen((o) => !o)}
              className='mb-3 text-sm font-medium text-ink underline underline-offset-2 min-[1200px]:hidden'
            >
              {previewOpen ? t('admin.questionnaire.preview.hide') : t('admin.questionnaire.preview.show')}
            </button>
            <div className={previewOpen ? '' : 'hidden min-[1200px]:block'}>
              <WhatsAppPreview model={model} view={view} focus={focus} />
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}
