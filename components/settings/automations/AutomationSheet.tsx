'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import ModalPop from '@/lib/modals/ModalPop'
import { Btn } from '@/lib/btns/Btn'
import { Input, Select } from '@/lib/form'
import { Seperator } from '@/lib/Seperator'
import { toast } from '@/lib/toast'
import { substituteVariables, variableChipsForEvent } from '@/lib/automations/variables'
import { TIMING_ACCURACY_COPY } from '@/lib/automations/copy'
import {
  getEvent,
  listActionsForEvent,
  listAnchorFields,
  listSelectableEvents,
  listSubjects,
} from '@/lib/automations/catalog/registry'
import { evaluateEvents, isSelectable, type RequirementContext } from '@/lib/automations/requirements'
import type { Connection } from '@/lib/automations/catalog/types'
import RemoteParameters from './RemoteParameters'
import type { Timing } from '@/lib/automations/timing'
import type { Condition } from '@/lib/automations/conditions'
import { createAutomation, updateAutomation, type AutomationInput } from '@/actions/automations/manage'
import { sendTestEmail } from '@/actions/automations/sendTest'
import { TIMINGS, errorMessage as msg, timingKey } from './sheetOptions'
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
  subject: string
  body: string
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
  const [timing, setTiming] = useState<Timing>(draft.timing)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [testing, startTest] = useTransition()

  const subjectRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const bodyRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const lastFocused = useRef<'subject' | 'body'>('body')

  const evaluated = useMemo(() => evaluateEvents(listSelectableEvents(), requirementContext), [requirementContext])
  const events = evaluated.map((e) => e.event)
  const event = getEvent(eventKey)
  // V1 renders one action — the first the event can offer. The catalog decides
  // which that is (requires × fields); the Builder never names it.
  const action = event ? (listActionsForEvent(event)[0] ?? null) : null
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

  /** Connections this integration offers. Generic — no integration is named. */
  const eligibleConnections = connections

  function insertToken(token: string) {
    const target = lastFocused.current
    const el = target === 'subject' ? subjectRef.current : bodyRef.current
    const value = target === 'subject' ? subject : body
    const set = target === 'subject' ? setSubject : setBody
    const at = el?.selectionStart ?? value.length
    set(`${value.slice(0, at)}{{${token}}}${value.slice(at)}`)
    queueMicrotask(() => el?.focus())
  }

  const payload = (): AutomationInput => ({
    name,
    recipeKey: draft.recipeKey,
    eventKey,
    conditions,
    connectionId,
    parameters,
    subject,
    body,
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
      const res = await sendTestEmail({ subject, body })
      if (res.ok === false) return setError(msg(res.reason))
      toast('success', 'אימייל הבדיקה נשלח אליך')
    })
  }

  const previewVars = { leadFirstName: previewName, businessName: null, repName: null }
  const previewSubject = substituteVariables(subject, previewVars)
  const previewBody = substituteVariables(body, previewVars)

  return (
    <ModalPop open onClose={onClose} pos='top' label={draft.id ? 'עריכת אוטומציה' : 'אוטומציה חדשה'}>
      <div className='grid gap-5 w-[min(90vw,560px)] pt-2'>
        <h2 className='text-lg font-semibold text-gray-800'>{draft.id ? 'עריכת אוטומציה' : 'אוטומציה חדשה'}</h2>

        <Input lbl='שם האוטומציה' value={name} onChange={(e) => setName(e.target.value)} />

        <Seperator className='my-0' />

        <section className='grid gap-3'>
          <h3 className='text-sm font-semibold text-gray-800'>כש</h3>
          <Select
            lbl='מתי זה צריך לקרות'
            options={grouped.map((g) => ({
              head: g.subject.title,
              grp: g.items.map((e) => ({
                id: e.event.key,
                // A locked event stays VISIBLE and says why (§4 Q5).
                name: isSelectable(e.availability) ? e.event.title : `${e.event.title} — דורש חיבור`,
              })),
            }))}
            value={eventKey}
            onChange={(e) => {
              setEventKey(e.target.value)
              setConditions([]) // conditions belong to the event's fields
            }}
          />
          {event && <p className='text-sm text-gray-500 ms-1'>{event.description}</p>}

          {locked && (
            <div className='border border-amber-200 rounded-md bg-amber-50 p-3 grid gap-2' role='alert'>
              <p className='text-sm text-amber-800'>האירוע הזה עדיין לא זמין בחשבון שלכם.</p>
              {locked.cta && <Btn variant='outline' size='small' lbl={locked.cta.label} href={locked.cta.href} />}
            </div>
          )}

          {eligibleConnections.length > 1 && (
            <Select
              lbl='חיבור'
              options={eligibleConnections.map((c) => ({ id: c.id, name: c.displayName }))}
              value={connectionId ?? ''}
              onChange={(e) => setConnectionId(e.target.value || null)}
            />
          )}

          {/* Event parameters — rendered generically from catalog metadata. */}
          <RemoteParameters
            parameters={event?.parameters ?? []}
            connectionId={connectionId ?? eligibleConnections[0]?.id ?? null}
            values={parameters}
            onChange={setParameters}
          />
        </section>

        <Seperator className='my-0' />

        <ConditionsEditor event={event} conditions={conditions} onChange={setConditions} />

        <Seperator className='my-0' />

        <section className='grid gap-3'>
          <h3 className='text-sm font-semibold text-gray-800'>{action ? action.title : 'פעולה'}</h3>
          <Input
            ref={subjectRef}
            lbl='נושא האימייל'
            value={subject}
            onFocus={() => (lastFocused.current = 'subject')}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={120}
          />
          <Input
            ref={bodyRef}
            as='textarea'
            lbl='תוכן האימייל'
            value={body}
            rows={8}
            onFocus={() => (lastFocused.current = 'body')}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className='flex flex-wrap items-center gap-2'>
            <span className='text-sm text-gray-500'>הוספת פרטים:</span>
            {chips.map((c) => (
              <Btn key={c.field} variant='outline' size='small' lbl={c.token} onClick={() => insertToken(c.token)} />
            ))}
          </div>
        </section>

        <Seperator className='my-0' />

        <section className='grid gap-3'>
          <h3 className='text-sm font-semibold text-gray-800'>מתי לשלוח</h3>
          <div className='flex flex-wrap gap-2'>
            {TIMINGS.map((t) => (
              <Btn
                key={t.key}
                variant={timingKey(timing) === t.key ? 'solid' : 'outline'}
                size='small'
                lbl={t.lbl}
                onClick={() => setTiming(t.timing)}
              />
            ))}
          </div>
          {anchors.length > 0 && (
            <p className='text-sm text-gray-500 ms-1'>אפשר גם לתזמן ביחס ל{anchors.map((a) => a.label).join(' / ')}.</p>
          )}
          <p className='text-sm text-gray-500 ms-1'>{TIMING_ACCURACY_COPY}</p>
        </section>

        <Seperator className='my-0' />

        {/* Preview is driven by the ACTION's declared preview shape. */}
        <section className='grid gap-2'>
          <h3 className='text-sm font-semibold text-gray-800'>כך זה ייראה{previewName ? ` אצל ${previewName}` : ''}</h3>
          <div className='border rounded-md bg-gray-50 p-4 grid gap-2'>
            {action?.preview === 'email' && (
              <>
                <p className='text-sm font-semibold text-gray-800'>{previewSubject || 'ללא נושא'}</p>
                <p className='text-sm text-gray-600 whitespace-pre-line'>{previewBody || 'ללא תוכן'}</p>
              </>
            )}
            {action?.preview === 'message' && (
              <p className='text-sm text-gray-600 whitespace-pre-line'>{previewBody || 'ללא תוכן'}</p>
            )}
            {action?.preview === 'record' && <p className='text-sm text-gray-600'>{previewSubject || 'רשומה חדשה'}</p>}
            {(!action || action.preview === 'none') && <p className='text-sm text-gray-600'>לא נשלחת הודעה ללקוח</p>}
          </div>
        </section>

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
