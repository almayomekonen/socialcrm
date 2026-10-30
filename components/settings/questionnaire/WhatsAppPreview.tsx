'use client'

import { useEffect, useRef } from 'react'
import type { EditorView } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import { describeConditionIn } from './issueText'
import { useT } from '@/lib/i18n/I18nProvider'
import { conditionOf, keyOf } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import type { BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import ChatBubble from './ChatBubble'

export type PreviewFocus = { kind: 'question'; key: string } | { kind: 'ending'; index: number } | null

/**
 * "מה הלקוח יקבל?" — the conversation as WhatsApp will carry it.
 *
 * Every bubble is text produced by production code (editorView.ts): the opening
 * with the first question and its numbered menu, the question being edited, and
 * the ending. Nothing is formatted here. The preview follows the card the owner
 * is working on, so the message under their cursor is always on screen.
 */
export default function WhatsAppPreview({
  model,
  view,
  focus,
}: {
  model: BuilderQuestionnaire
  view: EditorView
  focus: PreviewFocus
}) {
  const t = useT()
  const focused = focus?.kind === 'question' ? model.questions.find((q) => keyOf(q) === focus.key) : undefined
  const showFocused = focused && keyOf(focused) !== view.firstQuestionKey && view.messages[keyOf(focused)]
  const when = focused ? describeConditionIn(model, conditionOf(focused), t) : null
  const endingIndex = focus?.kind === 'ending' ? focus.index : -1
  const ending = endingIndex >= 0 ? view.endings.custom[endingIndex] : view.endings.standard
  // The message being edited is kept on screen inside the preview, however long the opening is.
  const focusRef = useRef<HTMLDivElement>(null)
  const focusKey = focus ? (focus.kind === 'question' ? focus.key : `ending-${focus.index}`) : ''
  useEffect(() => {
    try {
      focusRef.current?.scrollIntoView?.({ block: 'nearest' })
    } catch {
      /* not scrollable here */
    }
  }, [focusKey])

  return (
    <section aria-labelledby='questionnaire-preview-title' className='flex flex-col gap-3'>
      <div>
        <h2 id='questionnaire-preview-title' className='text-base font-semibold text-ink'>
          {t('admin.questionnaire.preview.title')}
        </h2>
        <p className='mt-1 text-xs text-gray-500'>{t('admin.questionnaire.preview.hint')}</p>
      </div>

      <div className='flex max-h-[calc(100vh-14rem)] min-h-64 flex-col gap-2.5 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-4'>
        <ChatBubble from='customer' text={t('admin.questionnaire.preview.hi')} label={t('admin.questionnaire.preview.customer')} />
        {view.opening ? (
          <ChatBubble from='business' text={view.opening} label={t('admin.questionnaire.preview.business')} />
        ) : (
          <p className='text-center text-sm text-gray-500'>{t('admin.questionnaire.preview.noOpening')}</p>
        )}

        {showFocused && (
          <div ref={focusRef} className='flex flex-col gap-2.5'>
            <p className='mt-2 text-center text-xs text-gray-500'>{when ? t('admin.questionnaire.preview.laterWhen', { when }) : t('admin.questionnaire.preview.later')}</p>
            <ChatBubble from='business' text={view.messages[keyOf(focused)]} label={t('admin.questionnaire.preview.business')} />
          </div>
        )}

        {ending && (
          <div ref={endingIndex >= 0 ? focusRef : undefined} className='flex flex-col gap-2.5'>
            <p className='mt-2 text-center text-xs text-gray-500'>
              {endingIndex >= 0 ? t('admin.questionnaire.preview.endingCustom') : t('admin.questionnaire.preview.endingStandard')}
            </p>
            <ChatBubble from='business' text={ending} label={t('admin.questionnaire.preview.ending')} />
          </div>
        )}
      </div>
    </section>
  )
}
