'use client'

import { useState, useTransition } from 'react'
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
import { errorMessage as msg } from './sheetOptions'
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
      toast('success', draft.id ? 'האוטומציה עודכנה' : 'האוטומציה נשמרה כטיוטה')
      onSaved()
    })
  }

  function test() {
    // Sending a test email is real outbound delivery, so it is gated like any
    // other spend. Answered as a billing prompt before the request is made.
    if (proLocked) {
      return proToast({
        title: 'שליחת אימייל בדיקה זמינה עם Pro',
        body: 'חידוש המנוי יחזיר את שליחת הבדיקות.',
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
      toast('success', 'אימייל הבדיקה נשלח אליך')
    })
  }

  return (
    <ModalPop open onClose={onClose} pos='top' label={draft.id ? 'עריכת אוטומציה' : 'אוטומציה חדשה'}>
      <div className='grid gap-5 w-[min(90vw,560px)] pt-2'>
        <h2 className='text-lg font-semibold text-gray-800'>{draft.id ? 'עריכת אוטומציה' : 'אוטומציה חדשה'}</h2>

        <Input lbl='שם האוטומציה' value={name} onChange={(e) => d.setName(e.target.value)} />

        <Seperator className='my-0' />

        <AutomationTriggerSection
          grouped={grouped}
          event={event}
          eventKey={eventKey}
          locked={locked}
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

        <ConditionsEditor event={event} conditions={conditions} onChange={d.setConditions} />

        <Seperator className='my-0' />

        <AutomationActionSection
          actions={actions}
          action={action}
          actionKey={actionKey}
          onActionKeyChange={d.setChosenActionKey}
          subject={subject}
          body={body}
          cta={cta}
          chips={chips}
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

        <AutomationTimingSection timing={timing} anchors={anchors} onChange={d.setTiming} />

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
              feature='חידוש המנוי מחזיר את הפעלת האוטומציות'
            />
          ) : (
            <Btn
              lbl={pending ? 'שומר…' : draft.id ? 'שמור שינויים' : 'שמור אוטומציה'}
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
              lbl={testing ? 'שולח…' : 'שלח אליי בדיקה'}
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
