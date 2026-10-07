'use client'

import { useEffect, useRef } from 'react'
import type { EditorView } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import { describeCondition } from '@/lib/inbox/autoresponse/questionnaire/builder/conditionText'
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
  const focused = focus?.kind === 'question' ? model.questions.find((q) => keyOf(q) === focus.key) : undefined
  const showFocused = focused && keyOf(focused) !== view.firstQuestionKey && view.messages[keyOf(focused)]
  const when = focused ? describeCondition(model, conditionOf(focused)) : null
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
          מה הלקוח יקבל
        </h2>
        <p className='mt-1 text-xs text-gray-500'>כך ההודעות ייראו בוואטסאפ. התצוגה מתעדכנת בזמן העריכה.</p>
      </div>

      <div className='flex max-h-[calc(100vh-14rem)] min-h-64 flex-col gap-2.5 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-4'>
        <ChatBubble from='customer' text='היי' label='הלקוח' />
        {view.opening ? (
          <ChatBubble from='business' text={view.opening} label='הודעה מהעסק' />
        ) : (
          <p className='text-center text-sm text-gray-500'>כשתוסיפו שאלה שמופיעה תמיד, כאן תופיע ההודעה הראשונה.</p>
        )}

        {showFocused && (
          <div ref={focusRef} className='flex flex-col gap-2.5'>
            <p className='mt-2 text-center text-xs text-gray-500'>{when ? `בהמשך, כאשר ${when}:` : 'בהמשך השיחה:'}</p>
            <ChatBubble from='business' text={view.messages[keyOf(focused)]} label='הודעה מהעסק' />
          </div>
        )}

        {ending && (
          <div ref={endingIndex >= 0 ? focusRef : undefined} className='flex flex-col gap-2.5'>
            <p className='mt-2 text-center text-xs text-gray-500'>
              {endingIndex >= 0 ? 'בסוף השאלון, בסיום השונה הזה:' : 'בסוף השאלון:'}
            </p>
            <ChatBubble from='business' text={ending} label='הודעת הסיום' />
          </div>
        )}
      </div>
    </section>
  )
}
