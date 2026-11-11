'use client'

import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import ModalPop from '@/lib/modals/ModalPop'
import { useT } from '@/lib/i18n/I18nProvider'
import { untranslatedAttrs } from '@/lib/i18n/config'
import AgentPreviewChat from './AgentPreviewChat'
import { useAgentPreviewChat, type AgentPreviewChatState } from './useAgentPreviewChat'

/**
 * "בדקו את הסוכן שלכם" — the owner talks to their own agent before a customer
 * does.
 *
 * PLACEMENT. On a wide screen the chat is a sticky panel beside the form
 * (`AgentPreviewPanel`), so the owner edits on one side and sees the agent
 * answer on the other. Below `xl` there is no room beside the form — the app
 * rail, the settings nav and the page padding take ~350px of the viewport, so at
 * `lg` (1024px) the form column measured 230px — and the panel is hidden and `AgentPreviewLauncher`, placed with the agent's fields, opens the
 * same chat in the existing dialog (ModalPop). Both read one conversation state
 * (`useAgentPreview`), so resizing the window never loses the test chat. This is
 * responsive layout, not a mobile-only component — phones never reach this form
 * (the page serves AutoResponseMobile to them; architecture-rules §9).
 *
 * DRAFT VS SAVED. The chat sends whatever is currently typed in the business
 * description and the advanced instructions — the two draft fields the preview
 * action accepts — and says whether the reply used saved or unsaved text.
 *
 * LANGUAGE. This is the AI agent's test chat: its replies, notes and chrome are
 * AI output / AI configuration, out of scope by owner order (no AI
 * localization). Outside Hebrew both roots re-declare Hebrew.
 */
type Input = {
  /** Current textarea contents, saved or not. */
  draftDescription: string
  draftAgentInstructions: string
  /** What is actually stored, so the chat can tell the owner which it used. */
  savedDescription: string
  businessName: string
}

export type AgentPreviewState = {
  chat: AgentPreviewChatState
  businessName: string
  hasDescription: boolean
  isDraft: boolean
}

export function useAgentPreview({ draftDescription, draftAgentInstructions, savedDescription, businessName }: Input): AgentPreviewState {
  const chat = useAgentPreviewChat({ draftDescription, draftAgentInstructions })
  return {
    chat,
    businessName,
    hasDescription: draftDescription.trim().length > 0,
    isDraft: draftDescription.trim() !== savedDescription.trim(),
  }
}

/** Wide screens: the sticky chat panel beside the form. */
export function AgentPreviewPanel({ preview }: { preview: AgentPreviewState }) {
  const hebrew = untranslatedAttrs(useT().locale)
  return (
    <aside className='hidden xl:sticky xl:top-6 xl:block xl:self-start' aria-label='בדיקת הסוכן' data-agent-preview='panel' {...hebrew}>
      <AgentPreviewChat {...preview} />
    </aside>
  )
}

/** Below `xl`: one button that opens the same chat in a dialog. */
export function AgentPreviewLauncher({ preview }: { preview: AgentPreviewState }) {
  const hebrew = untranslatedAttrs(useT().locale)
  const [open, setOpen] = useState(false)
  return (
    <div className='xl:hidden' data-agent-preview='launcher' {...hebrew}>
      <div className='flex flex-wrap items-center gap-3'>
        <Btn type='button' lbl='בדקו את הסוכן שלכם' onClick={() => setOpen(true)} disabled={!preview.hasDescription} />
        <p className='text-sm text-gray-600'>
          {preview.hasDescription
            ? 'שיחת בדיקה שלא נשלחת לאף אחד. אפשר לכתוב כמו לקוח ולראות מה הסוכן עונה.'
            : 'כתבו קודם על העסק כדי לבדוק את הסוכן.'}
        </p>
      </div>
      <ModalPop open={open} onClose={() => setOpen(false)} label='בדיקת הסוכן' className='w-[min(calc(100vw-2rem),32rem)]'>
        <div className='p-5' {...hebrew}>
          <AgentPreviewChat {...preview} />
        </div>
      </ModalPop>
    </div>
  )
}
