'use client'

import { useMemo, useState, useTransition } from 'react'
import ModalPop from '@/lib/modals/ModalPop'
import { Btn } from '@/lib/btns/Btn'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { Input } from '@/lib/form'
import { Seperator } from '@/lib/Seperator'
import { toast, proToast } from '@/lib/toast'
import type { RequirementContext } from '@/lib/automations/requirements'
import type { Connection } from '@/lib/automations/catalog/types'
import { type CtaDraft } from './AutomationContentSection'
import AutomationActionSection from './AutomationActionSection'
import AutomationTimingSection from './AutomationTimingSection'
import AutomationTriggerSection from './AutomationTriggerSection'
import AutomationPreviewSection from './AutomationPreviewSection'
import type { Timing } from '@/lib/automations/timing'
import type { Condition } from '@/lib/automations/conditions'
import { createAutomation, updateAutomation } from '@/actions/automations/manage'
import { sendTestEmail } from '@/actions/automations/sendTest'
import { errorMessageIn } from './sheetOptions'
import { useT } from '@/lib/i18n/I18nProvider'
import { localizeRequirement } from '@/lib/automations/catalogI18n'
import { sheetDisplay } from './sheetDisplay'
import ConditionsEditor from './ConditionsEditor'
import { useAutomationSheetDraft } from './useAutomationSheetDraft'

/**
 * Creation/edit in ONE sheet (frozen spec §7) — now fully EVENT-FIRST and
 * fully catalog-driven.
 *
 * Everything this component renders it learns from catalog metadata: the event
 * list and its grouping, the condition fields/operators/values, the variable
 * chips, the timing anchors, and the preview shape. It names no integration,
 * no status and no trigger. Adding an event to the catalog changes nothing
 * here.
 *
 * Actions are visually limited to one; storage keeps the list shape.
 */

export type SheetDraft = {
  id?: number
  name: string
  recipeKey: string | null
  eventKey: string
  conditions: Condition[]
  connectionId: string | null
  parameters: Record<string, string>
  /** Which action this automation runs. Absent ⇒ the event's first offerable one. */
  actionKey?: string | null
  subject: string
  body: string
  /** The optional CTA block; null when the email has none. */
  cta: CtaDraft | null
  /** The message action's authored surface: chosen template + slot mapping. */
  templateId?: number | null
  templateBindings?: Record<string, string> | null
  /** A title-shaped action's authored surface: the one line it writes. */
  title?: string | null
  /** Answers to the action's catalog-declared parameters, keyed by key. */
  actionParameters?: Record<string, string> | null
  timing: Timing
}

export default function AutomationSheet({
  draft,
  previewName,
  requirementContext,
  connections,
  onClose,
  onSaved,
}: {
  draft: SheetDraft
  previewName: string | null
  requirementContext: RequirementContext
  connections: readonly Connection[]
  onClose: () => void
  onSaved: () => void
}) {
  const d = useAutomationSheetDraft(draft, requirementContext, connections)
  const { name, eventKey, conditions, parameters, subject, body, cta, templateId, templateBindings, taskTitle, actionParameters, timing } = d
  const { event, actions, actionKey, action, chips, anchors, grouped, locked, eligibleConnections, boundConnectionId, payload } = d
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [testing, startTest] = useTransition()

  // What the sections SHOW, in the interface language (sheetDisplay.ts).
  const t = useT()
  const L = t.locale
  const msg = (reason: string) => errorMessageIn(reason, L)
  const shown = useMemo(() => sheetDisplay({ grouped, event, actions, action, anchors, chips }, L), [L, grouped, event, actions, action, anchors, chips])

  /**
   * TIER 2. The definition stays fully editable to read and explore; saving is
   * what arms an automation to send, so that is where the gate belongs.
   */
  const proLocked = useAccessDenied()

  function save() {
    setError(null)
    startTransition(async () => {
      const res = draft.id ? await updateAutomation(draft.id, payload()) : await createAutomation(payload())
      if (res.ok === false) return setError(msg(res.reason))
      toast('success', draft.id ? t('admin.automationSheet.updated') : t('admin.automationSheet.saved'))
      onSaved()
    })
  }

  function test() {
    // Sending a test email is real outbound delivery, so it is gated like any
    // other spend. Answered as a billing prompt before the request is made.
    if (proLocked) {
      return proToast({
        title: t('admin.automationSheet.pro.title'),
        body: t('admin.automationSheet.pro.body'),
        source: 'automation_test_send',
      })
    }
    setError(null)
    startTest(async () => {
      const res = await sendTestEmail({
        subject,
        body,
        ctaLabel: cta?.label ?? null,
        ctaUrl: cta?.url ?? null,
      })
      if (res.ok === false) return setError(msg(res.reason))
      toast('success', t('admin.automationSheet.testSent'))
    })
  }

  return (
    <ModalPop open onClose={onClose} pos='top' label={draft.id ? t('admin.automationSheet.editTitle') : t('admin.automationSheet.newTitle')} translated>
      <div className='grid gap-5 w-[min(90vw,560px)] pt-2'>
        <h2 className='text-lg font-semibold text-gray-800'>{draft.id ? t('admin.automationSheet.editTitle') : t('admin.automationSheet.newTitle')}</h2>

        <Input lbl={t('admin.automationSheet.name')} value={name} onChange={(e) => d.setName(e.target.value)} />

        <Seperator className='my-0' />

        <AutomationTriggerSection
          grouped={shown.grouped}
          event={shown.event}
          eventKey={eventKey}
          locked={localizeRequirement(locked, L)}
          eligibleConnections={eligibleConnections}
          boundConnectionId={boundConnectionId}
          parameters={parameters}
          onEventKeyChange={(next) => {
            d.setEventKey(next)
            d.setConditions([]) // conditions belong to the event's fields
          }}
          onConnectionChange={d.setConnectionId}
          onParametersChange={d.setParameters}
        />

        <Seperator className='my-0' />

        <ConditionsEditor event={shown.event} conditions={conditions} onChange={d.setConditions} />

        <Seperator className='my-0' />

        <AutomationActionSection
          actions={shown.actions}
          action={shown.action}
          actionKey={actionKey}
          onActionKeyChange={d.setChosenActionKey}
          subject={subject}
          body={body}
          cta={cta}
          chips={shown.chips}
          subjectRef={d.subjectRef}
          bodyRef={d.bodyRef}
          templateId={templateId}
          templateBindings={templateBindings}
          titleValue={taskTitle}
          titleRef={d.titleRef}
          actionParameters={actionParameters}
          onFocusField={(field) => (d.lastFocused.current = field)}
          onSubjectChange={d.setSubject}
          onBodyChange={d.setBody}
          onCtaChange={d.setCta}
          onInsertToken={d.insertToken}
          onTemplateChange={d.setTemplateId}
          onBindingsChange={d.setTemplateBindings}
          onTitleChange={d.setTaskTitle}
          onActionParametersChange={d.setActionParameters}
        />

        <Seperator className='my-0' />

        <AutomationTimingSection timing={timing} anchors={shown.anchors} onChange={d.setTiming} />

        <Seperator className='my-0' />

        <AutomationPreviewSection
          action={action}
          previewName={previewName}
          subject={subject}
          body={body}
          cta={cta}
          templateId={templateId}
          templateBindings={templateBindings}
          title={taskTitle}
        />

        <div className='grid gap-2'>
          {proLocked ? (
            <SubscriptionExpiredState
              mode='inline'
              source='automation_save'
              feature={t('admin.automations.expiredFeature')}
              translated
            />
          ) : (
            <Btn
              lbl={pending ? t('admin.automationSheet.saving') : draft.id ? t('admin.automationSheet.saveChanges') : t('admin.automationSheet.save')}
              icon={pending ? 'spinner' : 'floppy-disk'}
              iconClassName={pending ? 'animate-spin' : undefined}
              disabled={pending || testing || !!locked}
              className='w-full'
              onClick={save}
            />
          )}
          {action?.testable && (
            <Btn
              variant='outline'
              lbl={testing ? t('admin.automationSheet.sending') : t('admin.automationSheet.test')}
              icon={testing ? 'spinner' : 'paper-plane'}
              iconClassName={testing ? 'animate-spin' : undefined}
              disabled={pending || testing}
              className='w-full'
              onClick={test}
            />
          )}
          {error && (
            <p className='text-sm text-red-600 ms-1' role='alert'>
              {error}
            </p>
          )}
        </div>
      </div>
    </ModalPop>
  )
}
