'use client'

import { type RefObject } from 'react'
import { Select } from '@/lib/form'
import type { ActionDefinition } from '@/lib/automations/catalog/types'
import AutomationContentSection, { type CtaDraft } from './AutomationContentSection'
import AutomationTemplateSection from './AutomationTemplateSection'
import AutomationTitleSection from './AutomationTitleSection'
import RemoteParameters from './RemoteParameters'
import { actionFallbackIn } from '@/lib/automations/catalogI18n'
import { useT } from '@/lib/i18n/I18nProvider'

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
 * parameters — a `templateId` parameter means the content is a chosen template,
 * a `title` parameter means the content is one line — so this component names
 * no channel and no action.
 *
 * Parameters the catalog can describe generically (`enum_agency` today) are
 * rendered by `RemoteParameters`, the SAME component the trigger section uses
 * for an event's parameters. They are additive to whichever content shape the
 * action uses, so an action that declares only generic parameters gets a form
 * made entirely of them — with no branch here naming it.
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
  titleValue,
  titleRef,
  actionParameters,
  onFocusField,
  onSubjectChange,
  onBodyChange,
  onCtaChange,
  onInsertToken,
  onTemplateChange,
  onBindingsChange,
  onTitleChange,
  onActionParametersChange,
}: {
  actions: readonly ActionDefinition[]
  action: ActionDefinition | null
  actionKey: string
  onActionKeyChange: (next: string) => void
  subject: string
  body: string
  cta: CtaDraft | null
  chips: readonly { token: string; field: string; label?: string }[]
  subjectRef: RefObject<(HTMLInputElement & HTMLTextAreaElement) | null>
  bodyRef: RefObject<(HTMLInputElement & HTMLTextAreaElement) | null>
  templateId: string
  templateBindings: Record<string, string>
  titleValue: string
  titleRef: RefObject<(HTMLInputElement & HTMLTextAreaElement) | null>
  /** Answers to the action's catalog-declared parameters, keyed by key. */
  actionParameters: Record<string, string>
  onFocusField: (field: 'subject' | 'body') => void
  onSubjectChange: (value: string) => void
  onBodyChange: (value: string) => void
  onCtaChange: (next: CtaDraft | null) => void
  onInsertToken: (token: string) => void
  onTemplateChange: (next: string) => void
  onBindingsChange: (next: Record<string, string>) => void
  onTitleChange: (next: string) => void
  onActionParametersChange: (next: Record<string, string>) => void
}) {
  const t = useT()
  const fallbackTitle = actionFallbackIn(t.locale)
  const templateParameter = action?.parameters.find((p) => p.key === 'templateId') ?? null
  const titleParameter = action?.parameters.find((p) => p.key === 'title') ?? null
  /**
   * Parameters the generic renderer can draw. Selected by TYPE, never by key, so
   * a second generically-rendered type needs no edit here — and no action is
   * ever named.
   */
  const genericParameters = (action?.parameters ?? []).filter((p) => p.type === 'enum_agency')
  /** A form made only of generic parameters needs no content section beside it. */
  const contentless = genericParameters.length > 0 && !templateParameter && !titleParameter
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
          lbl={t('admin.automationSheet.action.pick')}
          options={actions.map((a) => ({ id: a.key, name: a.title }))}
          value={actionKey}
          onChange={(e) => onActionKeyChange(e.target.value)}
        />
      )}
      {action?.description && actions.length > 1 && <p className='text-sm text-gray-500 ms-1'>{action.description}</p>}

      {genericParameters.length > 0 && (
        <section className='grid gap-3'>
          <h3 className='text-sm font-semibold text-gray-800'>{action ? action.title : fallbackTitle}</h3>
          <RemoteParameters
            parameters={genericParameters}
            // Agency-owned data needs no connection to resolve against.
            connectionId={null}
            values={actionParameters}
            onChange={onActionParametersChange}
          />
        </section>
      )}

      {contentless ? null : templateParameter ? (
        <AutomationTemplateSection
          title={action ? action.title : fallbackTitle}
          parameter={templateParameter}
          capability={capability}
          templateId={templateId}
          bindings={templateBindings}
          onTemplateChange={onTemplateChange}
          onBindingsChange={onBindingsChange}
        />
      ) : titleParameter ? (
        <AutomationTitleSection
          title={action ? action.title : fallbackTitle}
          parameter={titleParameter}
          value={titleValue}
          inputRef={titleRef}
          onChange={onTitleChange}
          onInsertToken={onInsertToken}
        />
      ) : (
        <AutomationContentSection
          title={action ? action.title : fallbackTitle}
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
