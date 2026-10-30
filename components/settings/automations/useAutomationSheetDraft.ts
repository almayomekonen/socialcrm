'use client'

import { useMemo, useRef, useState } from 'react'
import { variableChipsForEvent } from '@/lib/automations/variables'
import {
  getEvent,
  listActionsForEvent,
  listAnchorFields,
  listIntegrations,
  listSelectableEvents,
  listSubjects,
} from '@/lib/automations/catalog/registry'
import { evaluateEvents, type RequirementContext } from '@/lib/automations/requirements'
import type { Connection } from '@/lib/automations/catalog/types'
import type { Timing } from '@/lib/automations/timing'
import type { Condition } from '@/lib/automations/conditions'
import type { AutomationInput } from '@/lib/automations/definitionInput'
import type { CtaDraft } from './AutomationContentSection'
import type { SheetDraft } from './AutomationSheet'

/**
 * The sheet's draft: every field the customer edits, everything derived from
 * the catalog for the chosen event, chip insertion and the payload the save
 * submits.
 *
 * Extracted from AutomationSheet, which had crossed the file-size hard limit
 * (architecture-rules §1/§5: move logic before UI). The sheet stays the
 * orchestrator — it renders the sections and owns save / test — and this owns
 * the state they read. Nothing here changed in behaviour.
 */
export function useAutomationSheetDraft(draft: SheetDraft, requirementContext: RequirementContext, connections: readonly Connection[]) {
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
  const [actionParameters, setActionParameters] = useState<Record<string, string>>(draft.actionParameters ?? {})
  const [timing, setTiming] = useState<Timing>(draft.timing)

  const subjectRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const bodyRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const titleRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const lastFocused = useRef<'subject' | 'body'>('body')

  const evaluated = useMemo(() => evaluateEvents(listSelectableEvents(), requirementContext), [requirementContext])
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
    actionParameters,
    subject,
    body,
    // One block: an incomplete pair is sent as no block, matching what the
    // renderer would draw.
    ctaLabel: cta?.label?.trim() ? cta.label.trim() : null,
    ctaUrl: cta?.url?.trim() ? cta.url.trim() : null,
    timing,
  })

  return {
    name, setName, eventKey, setEventKey, conditions, setConditions, setConnectionId, parameters, setParameters,
    subject, setSubject, body, setBody, cta, setCta, setChosenActionKey, templateId, setTemplateId,
    templateBindings, setTemplateBindings, taskTitle, setTaskTitle, actionParameters, setActionParameters,
    timing, setTiming, subjectRef, bodyRef, titleRef, lastFocused,
    event, actions, actionKey, action, chips, anchors, grouped, locked, eligibleConnections, boundConnectionId,
    insertToken, payload,
  }
}
