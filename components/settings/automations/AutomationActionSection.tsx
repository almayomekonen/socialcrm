'use client'

import { type RefObject } from 'react'
import { Select } from '@/lib/form'
import type { ActionDefinition } from '@/lib/automations/catalog/types'
import AutomationContentSection, { type CtaDraft } from './AutomationContentSection'
import AutomationTemplateSection from './AutomationTemplateSection'

/**
 * WHAT the automation does — the choice, and the configuration that choice needs.
 *
 * Extracted from AutomationSheet at the moment a second action became reachable
 * (architecture-rules §1/§8: the touch is the trigger). The sheet was one line
 * under the hard limit; adding a picker and a second configuration form inside it
 * would have pushed it over, and the seam here is real rather than arbitrary —
 * this owns "which action and its content", the sheet stays the orchestrator.
 *
 * The picker appears ONLY when the event can genuinely offer more than one
 * action. With a single option there is no decision to present, and showing a
 * one-item dropdown would invent a choice the customer does not have.
 *
 * Which configuration form to render is decided by the ACTION'S OWN declared
 * parameters — a `templateId` parameter means the content is a chosen template —
 * so this component names no channel and a third action needs no branch here.
 */

export default function AutomationActionSection({
  actions,
  action,
  actionKey,
  onActionKeyChange,
  subject,
  body,
  cta,
  chips,
  subjectRef,
  bodyRef,
  templateId,
  templateBindings,
  onFocusField,
  onSubjectChange,
  onBodyChange,
  onCtaChange,
  onInsertToken,
  onTemplateChange,
  onBindingsChange,
}: {
  actions: readonly ActionDefinition[]
  action: ActionDefinition | null
  actionKey: string
  onActionKeyChange: (next: string) => void
  subject: string
  body: string
  cta: CtaDraft | null
  chips: readonly { token: string; field: string }[]
  subjectRef: RefObject<(HTMLInputElement & HTMLTextAreaElement) | null>
  bodyRef: RefObject<(HTMLInputElement & HTMLTextAreaElement) | null>
  templateId: string
  templateBindings: Record<string, string>
  onFocusField: (field: 'subject' | 'body') => void
  onSubjectChange: (value: string) => void
  onBodyChange: (value: string) => void
  onCtaChange: (next: CtaDraft | null) => void
  onInsertToken: (token: string) => void
  onTemplateChange: (next: string) => void
  onBindingsChange: (next: Record<string, string>) => void
}) {
  const templateParameter = action?.parameters.find((p) => p.key === 'templateId') ?? null
  /**
   * The capability the action's options live behind, taken from its own declared
   * requirement. The Builder learns a capability KEY and nothing about who grants
   * it — which is the whole of Law 1 for this control.
   */
  const capability = action?.requirements.find((r) => r.type === 'connection')?.key ?? null

  return (
    <div className='grid gap-3'>
      {actions.length > 1 && (
        <Select
          lbl='מה לעשות'
          options={actions.map((a) => ({ id: a.key, name: a.title }))}
          value={actionKey}
          onChange={(e) => onActionKeyChange(e.target.value)}
        />
      )}
      {action?.description && actions.length > 1 && <p className='text-sm text-gray-500 ms-1'>{action.description}</p>}

      {templateParameter ? (
        <AutomationTemplateSection
          title={action ? action.title : 'פעולה'}
          parameter={templateParameter}
          capability={capability}
          templateId={templateId}
          bindings={templateBindings}
          onTemplateChange={onTemplateChange}
          onBindingsChange={onBindingsChange}
        />
      ) : (
        <AutomationContentSection
          title={action ? action.title : 'פעולה'}
          subject={subject}
          body={body}
          cta={cta}
          chips={chips}
          subjectRef={subjectRef}
          bodyRef={bodyRef}
          onFocusField={onFocusField}
          onSubjectChange={onSubjectChange}
          onBodyChange={onBodyChange}
          onCtaChange={onCtaChange}
          onInsertToken={onInsertToken}
        />
      )}
    </div>
  )
}
