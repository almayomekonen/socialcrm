'use client'

import { createContext, useContext } from 'react'
import type { EditorIssue, EditorView } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import type { BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import type { ConfirmRequest } from '../builderCopy'

type Edit = (change: (m: BuilderQuestionnaire) => BuilderQuestionnaire) => void

/**
 * What every box on the canvas needs, shared once instead of copied into each
 * React Flow node's data. The draft is the same object the Conversation view
 * edits (useQuestionnaireDraft); the canvas has no state of its own beyond
 * where boxes sit.
 */
export type FlowEditor = {
  model: BuilderQuestionnaire
  view: EditorView
  edit: Edit
  confirm: (request: ConfirmRequest) => void
  announce: (message: string) => void
  /** Problems to show for a part (empty until the owner has been there or tried to publish). */
  issuesFor: (part: string) => EditorIssue[]
  /** Focus left a part: from now on its problems are shown. */
  leave: (part: string) => void
  /** The box being worked on: a question key, 'opening', 'endings', or none. Drives the preview. */
  select: (nodeId: string | null) => void
  /** Bring a box into view after it was created. */
  reveal: (nodeId: string) => void
  /** "question:option-l|r" for answers with a route of their own: the side its dot is drawn on. */
  routedOptions: ReadonlySet<string>
  /** A box that was just created and should take the cursor; cleared once it has. */
  focusRequest: string | null
  focusDone: () => void
  /** "+ הוספת שאלה" on the continue arrow leaving this box, or null when there is none to offer. */
  insertAfter: (nodeId: string) => { where: string; open: boolean; onOpen: (button: HTMLButtonElement) => void } | null
  /** After a deletion: put the cursor on this box's "עריכה" (or on "+ הוספת שאלה" for 'add'). */
  returnFocusTo: (nodeId: string) => void
  /** Switch to the Conversation view (for what the canvas does not edit). */
  openConversation: () => void
  /** "לקוח יכול לענות 'הכל'", decided on the server (canUseQuestionnaireNaturalAnswers): shown only where it has an effect. */
  allowAllEnabled?: boolean
}

export const FlowEditorContext = createContext<FlowEditor | null>(null)

export function useFlowEditor(): FlowEditor {
  const ctx = useContext(FlowEditorContext)
  if (!ctx) throw new Error('useFlowEditor outside FlowEditorContext')
  return ctx
}
