'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import ModalPop from '@/lib/modals/ModalPop'
import { Btn } from '@/lib/btns/Btn'
import { Input, Select } from '@/lib/form'
import { Seperator } from '@/lib/Seperator'
import { toast } from '@/lib/toast'
import { variableChipsForEvent } from '@/lib/automations/variables'
import { TIMING_ACCURACY_COPY } from '@/lib/automations/copy'
import {
  getEvent,
  listActionsForEvent,
  listAnchorFields,
  listIntegrations,
  listSelectableEvents,
  listSubjects,
} from '@/lib/automations/catalog/registry'
import { evaluateEvents, isSelectable, type RequirementContext } from '@/lib/automations/requirements'
import type { Connection } from '@/lib/automations/catalog/types'
import { type CtaDraft } from './AutomationContentSection'
import AutomationActionSection from './AutomationActionSection'
import AutomationTimingSection from './AutomationTimingSection'
import AutomationTriggerSection from './AutomationTriggerSection'
import AutomationPreviewSection from './AutomationPreviewSection'
import type { Timing } from '@/lib/automations/timing'
import type { Condition } from '@/lib/automations/conditions'
import { createAutomation, updateAutomation, type AutomationInput } from '@/actions/automations/manage'
import { sendTestEmail } from '@/actions/automations/sendTest'
import { errorMessage as msg, timingKey, timingOptionsFor } from './sheetOptions'
import ConditionsEditor from './ConditionsEditor'

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
  const [name, setName] = useState(draft.name)
  const [eventKey, setEventKey] = useState(draft.eventKey)
  const [conditions, setConditions] = useState<Condition[]>(draft.conditions ?? [])
  const [connectionId, setConnectionId] = useState<string | null>(draft.connectionId ?? null)
  const [parameters, setParameters] = useState<Record<string, string>>(draft.parameters ?? {})
  const [subject, setSubject] = useState(draft.subject)
  const [body, setBody] = useState(draft.body)
  const [cta, setCta] = useState<CtaDraft | null>(draft.cta ?? null)
  const [chosenActionKey, setChosenActionKey] = useState<string | null>(draft.actionKey ?? null)
  const [templateId, setTemplateId] = useState<string>(draft.templateId ? String(draft.templateId) : '')
  const [templateBindings, setTemplateBindings] = useState<Record<string, string>>(draft.templateBindings ?? {})
  const [taskTitle, setTaskTitle] = useState(draft.title ?? '')
  const [timing, setTiming] = useState<Timing>(draft.timing)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [testing, startTest] = useTransition()

  const subjectRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const bodyRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const titleRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const lastFocused = useRef<'subject' | 'body'>('body')

  const evaluated = useMemo(() => evaluateEvents(listSelectableEvents(), requirementContext), [requirementContext])
  const events = evaluated.map((e) => e.event)
  const event = getEvent(eventKey)
  /**
   * The actions this event can offer, and the one selected.
   *
   * Which actions exist is the catalog's answer (`requires` × the event's field
   * types); which one runs is the customer's, defaulting to the first. The Builder
   * still names none of them — it renders `a.title` from the catalog.
   */
  const actions = useMemo(() => (event ? listActionsForEvent(event) : []), [event])
  const actionKey = chosenActionKey && actions.some((a) => a.key === chosenActionKey) ? chosenActionKey : (actions[0]?.key ?? '')
  const action = actions.find((a) => a.key === actionKey) ?? null
  /** A template-shaped action stores a chosen message instead of authored text. */
  const isTemplateAction = Boolean(action?.parameters.some((p) => p.key === 'templateId'))
  /** A title-shaped action authors ONE line — no subject, no body, no CTA. */
  const isTitleAction = Boolean(action?.parameters.some((p) => p.key === 'title'))
  const chips = useMemo(() => (event ? variableChipsForEvent(event.fields) : []), [event])
  const anchors = event ? listAnchorFields(event) : []

  /** Events grouped by their declared subject — the picker's only structure. */
  const grouped = useMemo(() => {
    return listSubjects()
      .map((s) => ({ subject: s, items: evaluated.filter((e) => e.event.subject === s.key) }))
      .filter((g) => g.items.length > 0)
  }, [evaluated])

  /** The locked entry for the currently chosen event, if it is not runnable. */
  const lockedRequirement = evaluated.find((e) => e.event.key === eventKey && e.availability.state === 'locked')
  const locked = lockedRequirement?.availability.state === 'locked' ? lockedRequirement.availability.requirement : null

  /**
   * The connections that can actually satisfy THIS event.
   *
   * An event declares the capability it needs; an integration declares the
   * capabilities it provides. Intersecting the two is what stops a calendar
   * connection being offered for a website-form event — and it names no
   * integration to do it.
   *
   * An event with no connection requirement gets an empty list: binding a
   * `lead.created` automation to a connection would make it read as broken the
   * day that connection is revoked, which it would not be.
   */
  const eligibleConnections = useMemo(() => {
    const needed = new Set((event?.requirements ?? []).filter((r) => r.type === 'connection').map((r) => r.key))
    if (needed.size === 0) return []
    const providers = listIntegrations()
    return connections.filter((c) => {
      const integration = providers.find((i) => i.key === c.integrationKey)
      return integration?.capabilities.some((cap) => needed.has(cap)) ?? false
    })
  }, [connections, event])

  /**
   * §12 open question 3, answered the way the spec recommended: force a choice
   * when several exist, AUTO-SELECT when exactly one does.
   *
   * Without this the single-connection case saved `null` while the parameter
   * picker resolved its options against that same connection — so an
   * automation that plainly belonged to a connection was not bound to it, and
   * the Connections page reported "0 automations" for a connection actively
   * in use.
   */
  const boundConnectionId = connectionId ?? (eligibleConnections.length === 1 ? eligibleConnections[0].id : null)

  function insertToken(token: string) {
    // A title-shaped action has ONE field, so a chip always lands there. The
    // subject/body pair tracks focus because it has two.
    const target = isTitleAction ? 'title' : lastFocused.current
    const el = target === 'title' ? titleRef.current : target === 'subject' ? subjectRef.current : bodyRef.current
    const value = target === 'title' ? taskTitle : target === 'subject' ? subject : body
    const set = target === 'title' ? setTaskTitle : target === 'subject' ? setSubject : setBody
    const at = el?.selectionStart ?? value.length
    const before = value.slice(0, at)
    const after = value.slice(at)
    // Inserting a chip against another one produced `{{שם העסק}}{{שם העסק}}`,
    // which rendered as one run-together name in the real email. A chip always
    // lands separated from its neighbours.
    const lead = before.endsWith('}}') ? ' ' : ''
    const trail = after.startsWith('{{') ? ' ' : ''
    set(`${before}${lead}{{${token}}}${trail}${after}`)
    queueMicrotask(() => el?.focus())
  }

  const payload = (): AutomationInput => ({
    name,
    recipeKey: draft.recipeKey,
    eventKey,
    conditions,
    connectionId: boundConnectionId,
    parameters,
    // Explicit, so the server validates the content against the action the
    // customer actually chose rather than the event's first offerable one.
    actionKey,
    templateId: isTemplateAction && templateId ? Number(templateId) : null,
    templateBindings: isTemplateAction ? templateBindings : null,
    // Carried only by the action that authors it, so an email automation's
    // content document is unchanged from what it was before this field existed.
    title: isTitleAction ? taskTitle : null,
    subject,
    body,
    // One block: an incomplete pair is sent as no block, matching what the
    // renderer would draw.
    ctaLabel: cta?.label?.trim() ? cta.label.trim() : null,
    ctaUrl: cta?.url?.trim() ? cta.url.trim() : null,
    timing,
  })

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

        <Input lbl='שם האוטומציה' value={name} onChange={(e) => setName(e.target.value)} />

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
            setEventKey(next)
            setConditions([]) // conditions belong to the event's fields
          }}
          onConnectionChange={setConnectionId}
          onParametersChange={setParameters}
        />

        <Seperator className='my-0' />

        <ConditionsEditor event={event} conditions={conditions} onChange={setConditions} />

        <Seperator className='my-0' />

        <AutomationActionSection
          actions={actions}
          action={action}
          actionKey={actionKey}
          onActionKeyChange={setChosenActionKey}
          subject={subject}
          body={body}
          cta={cta}
          chips={chips}
          subjectRef={subjectRef}
          bodyRef={bodyRef}
          templateId={templateId}
          templateBindings={templateBindings}
          titleValue={taskTitle}
          titleRef={titleRef}
          onFocusField={(field) => (lastFocused.current = field)}
          onSubjectChange={setSubject}
          onBodyChange={setBody}
          onCtaChange={setCta}
          onInsertToken={insertToken}
          onTemplateChange={setTemplateId}
          onBindingsChange={setTemplateBindings}
          onTitleChange={setTaskTitle}
        />

        <Seperator className='my-0' />

        <AutomationTimingSection timing={timing} anchors={anchors} onChange={setTiming} />

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
          <Btn
            lbl={pending ? 'שומר…' : draft.id ? 'שמור שינויים' : 'שמור אוטומציה'}
            icon={pending ? 'spinner' : 'floppy-disk'}
            iconClassName={pending ? 'animate-spin' : undefined}
            disabled={pending || testing || !!locked}
            className='w-full'
            onClick={save}
          />
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
