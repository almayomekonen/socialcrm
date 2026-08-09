import {
  ACTION_RISKS,
  AUTH_STRATEGIES,
  CATALOG_KEY_PATTERN,
  EVENT_LIFECYCLES,
  EVENT_ORIGINS,
  FIRST_PARTY_SOURCES,
  FIELD_FRESHNESS,
  FIELD_LIFECYCLES,
  FIELD_TYPES,
  LAW_KEYS,
  PARAMETER_TYPES,
  PARAMETER_VALIDATORS,
  PREVIEW_SHAPES,
  REQUIREMENT_TYPES,
  SIMPLE_KEY_PATTERN,
} from './vocabularies'
import type { ActionDefinition, Catalog, EventDefinition, FieldDefinition, ParameterDefinition, Requirement } from './types'

export type CatalogIssue = { path: string; message: string }

const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const inSet = <T extends readonly string[]>(set: T, v: unknown): boolean => (set as readonly string[]).includes(v as string)

function validateRequirement(req: Requirement, path: string, issues: CatalogIssue[]): void {
  if (!inSet(REQUIREMENT_TYPES, req.type)) {
    issues.push({ path, message: `unknown requirement type "${req.type}" (allowed: ${REQUIREMENT_TYPES.join(', ')})` })
  }
  if (!isNonEmpty(req.key)) issues.push({ path, message: 'requirement.key is required' })
  // A connection gate the user cannot act on is a dead end, not a capability map.
  if (req.type === 'connection' && !req.cta) {
    issues.push({ path, message: 'connection requirements must declare a cta so the user can resolve them' })
  }
}

function validateParameter(p: ParameterDefinition, path: string, issues: CatalogIssue[]): void {
  if (!isNonEmpty(p.key)) issues.push({ path, message: 'parameter.key is required' })
  if (!isNonEmpty(p.label)) issues.push({ path, message: 'parameter.label is required (user-facing Hebrew)' })
  if (!inSet(PARAMETER_TYPES, p.type)) {
    issues.push({ path, message: `unknown parameter type "${p.type}" — no integration may introduce one (Law 4)` })
    return
  }
  if (p.type === 'enum_static' && (!p.options || p.options.length === 0)) {
    issues.push({ path, message: 'enum_static requires a non-empty options list' })
  }
  if (p.type === 'enum_remote' && !isNonEmpty(p.optionSource)) {
    issues.push({ path, message: 'enum_remote requires optionSource (the key passed to connection.options)' })
  }
  /**
   * A first-party parameter names one of a CLOSED set of agency-owned data
   * sets. Validating membership here — not only in the Server Action — means an
   * unknown source fails the build rather than rendering an empty dropdown a
   * customer would read as "you have none".
   */
  if (p.type === 'enum_agency') {
    if (!isNonEmpty(p.optionSource)) {
      issues.push({ path, message: 'enum_agency requires optionSource (a key from FIRST_PARTY_SOURCES)' })
    } else if (!inSet(FIRST_PARTY_SOURCES, p.optionSource)) {
      issues.push({
        path,
        message: `unknown first-party source "${p.optionSource}" (allowed: ${FIRST_PARTY_SOURCES.join(', ')})`,
      })
    }
  }
  if (p.type !== 'enum_remote' && p.type !== 'enum_agency' && p.optionSource) {
    issues.push({ path, message: 'optionSource is only meaningful for enum_remote and enum_agency' })
  }
  for (const key of Object.keys(p.validation ?? {})) {
    if (!inSet(PARAMETER_VALIDATORS, key)) {
      issues.push({ path, message: `unknown validator "${key}" — validators are a closed set (Law 4)` })
    }
  }
  if (p.validation?.pattern !== undefined) {
    try {
      new RegExp(p.validation.pattern)
    } catch {
      issues.push({ path, message: `validation.pattern is not a valid regex: ${p.validation.pattern}` })
    }
  }
}

function validateField(f: FieldDefinition, path: string, issues: CatalogIssue[]): void {
  if (!isNonEmpty(f.key)) issues.push({ path, message: 'field.key is required' })
  if (!isNonEmpty(f.label)) issues.push({ path, message: 'field.label is required (user-facing Hebrew)' })
  if (!inSet(FIELD_TYPES, f.type)) {
    issues.push({ path, message: `unknown field type "${f.type}" (allowed: ${FIELD_TYPES.join(', ')})` })
  }
  // Freshness is not optional: it decides what a delayed condition reads.
  if (!inSet(FIELD_FRESHNESS, f.freshness)) {
    issues.push({ path, message: `field.freshness must be one of: ${FIELD_FRESHNESS.join(', ')}` })
  }
  if (!inSet(FIELD_LIFECYCLES, f.lifecycle)) {
    issues.push({ path, message: `field.lifecycle must be one of: ${FIELD_LIFECYCLES.join(', ')}` })
  }
  if (f.type === 'enum' && (!f.options || f.options.length === 0)) {
    issues.push({ path, message: 'enum fields require a non-empty options list' })
  }
}

export function validateEvent(event: EventDefinition, subjectKeys: readonly string[]): CatalogIssue[] {
  const issues: CatalogIssue[] = []
  const at = `event:${event.key || '(missing key)'}`

  if (!CATALOG_KEY_PATTERN.test(event.key ?? '')) {
    issues.push({ path: at, message: 'key must be namespaced lowercase, e.g. "appointment.booked"' })
  }
  if (!inSet(EVENT_ORIGINS, event.origin)) {
    issues.push({ path: at, message: `unknown origin "${event.origin}" (allowed: ${EVENT_ORIGINS.join(', ')})` })
  }
  if (!inSet(EVENT_LIFECYCLES, event.lifecycle)) {
    issues.push({ path: at, message: `unknown lifecycle "${event.lifecycle}"` })
  }
  if (!subjectKeys.includes(event.subject)) {
    issues.push({ path: at, message: `subject "${event.subject}" is not a registered SubjectDefinition` })
  }
  for (const [prop, value] of [
    ['title', event.title],
    ['description', event.description],
    ['icon', event.icon],
  ] as const) {
    if (!isNonEmpty(value)) issues.push({ path: at, message: `${prop} is required` })
  }

  // Law 2 — an event that cannot resolve to exactly one Lead cannot exist.
  if (!isNonEmpty(event.identity?.occurrenceKey)) {
    issues.push({ path: at, message: 'identity.occurrenceKey is required (ADR-010 — how one occurrence is distinguished)' })
  }
  if (!isNonEmpty(event.identity?.leadResolution)) {
    issues.push({
      path: at,
      message: 'identity.leadResolution is required — every Event MUST resolve to exactly one Lead (Law 2)',
    })
  }

  const fieldKeys = new Set<string>()
  for (const f of event.fields ?? []) {
    if (fieldKeys.has(f.key)) issues.push({ path: `${at}.fields`, message: `duplicate field key "${f.key}"` })
    fieldKeys.add(f.key)
    validateField(f, `${at}.fields.${f.key}`, issues)
  }

  const paramKeys = new Set<string>()
  for (const p of event.parameters ?? []) {
    if (paramKeys.has(p.key)) issues.push({ path: `${at}.parameters`, message: `duplicate parameter key "${p.key}"` })
    paramKeys.add(p.key)
    validateParameter(p, `${at}.parameters.${p.key}`, issues)
  }

  for (const [i, req] of (event.requirements ?? []).entries()) {
    validateRequirement(req, `${at}.requirements[${i}]`, issues)
  }

  return issues
}

export function validateAction(action: ActionDefinition): CatalogIssue[] {
  const issues: CatalogIssue[] = []
  const at = `action:${action.key || '(missing key)'}`

  if (!CATALOG_KEY_PATTERN.test(action.key ?? '')) {
    issues.push({ path: at, message: 'key must be namespaced lowercase, e.g. "email.send"' })
  }
  for (const [prop, value] of [
    ['title', action.title],
    ['description', action.description],
    ['icon', action.icon],
  ] as const) {
    if (!isNonEmpty(value)) issues.push({ path: at, message: `${prop} is required` })
  }
  if (!inSet(ACTION_RISKS, action.risk)) {
    issues.push({ path: at, message: `unknown risk "${action.risk}" (allowed: ${ACTION_RISKS.join(', ')})` })
  }
  if (!inSet(PREVIEW_SHAPES, action.preview)) {
    issues.push({ path: at, message: `unknown preview shape "${action.preview}" — preview shapes are a closed set (Law 4)` })
  }
  if (typeof action.testable !== 'boolean') {
    issues.push({ path: at, message: 'testable must be declared explicitly' })
  }

  for (const t of action.requires ?? []) {
    if (!inSet(FIELD_TYPES, t)) issues.push({ path: `${at}.requires`, message: `unknown field type "${t}"` })
  }

  // §3.8 — the law set is declared per action; the engine composes from it.
  if (!Array.isArray(action.laws) || action.laws.length === 0) {
    issues.push({ path: `${at}.laws`, message: 'laws must be declared explicitly (an empty pipeline must be deliberate)' })
  }
  for (const law of action.laws ?? []) {
    if (!inSet(LAW_KEYS, law)) {
      issues.push({ path: `${at}.laws`, message: `unknown law "${law}" — no integration may add a law (Law 4)` })
    }
  }
  // Send-once is what makes an automation "once per lead"; omitting it is
  // never a considered choice in V1.
  if ((action.laws ?? []).length > 0 && !action.laws.includes('send_once')) {
    issues.push({ path: `${at}.laws`, message: 'send_once is required on every action' })
  }

  const paramKeys = new Set<string>()
  for (const p of action.parameters ?? []) {
    if (paramKeys.has(p.key)) issues.push({ path: `${at}.parameters`, message: `duplicate parameter key "${p.key}"` })
    paramKeys.add(p.key)
    validateParameter(p, `${at}.parameters.${p.key}`, issues)
  }

  for (const [i, req] of (action.requirements ?? []).entries()) {
    validateRequirement(req, `${at}.requirements[${i}]`, issues)
  }

  return issues
}

/** Validates the whole catalog, including cross-entity references. */
export function validateCatalog(catalog: Catalog): CatalogIssue[] {
  const issues: CatalogIssue[] = []

  for (const s of catalog.subjects) {
    if (!SIMPLE_KEY_PATTERN.test(s.key ?? '')) {
      issues.push({ path: `subject:${s.key}`, message: 'subject key must be lowercase single-segment' })
    }
    if (!isNonEmpty(s.title)) issues.push({ path: `subject:${s.key}`, message: 'title is required' })
  }

  for (const i of catalog.integrations) {
    if (!SIMPLE_KEY_PATTERN.test(i.key ?? '')) {
      issues.push({ path: `integration:${i.key}`, message: 'integration key must be lowercase single-segment' })
    }
    if (!inSet(AUTH_STRATEGIES, i.auth)) {
      issues.push({ path: `integration:${i.key}`, message: `unknown auth strategy "${i.auth}"` })
    }
  }

  const subjectKeys = catalog.subjects.map((s) => s.key)
  const seenEventKeys = new Set<string>()
  for (const e of catalog.events) {
    if (seenEventKeys.has(e.key)) issues.push({ path: `event:${e.key}`, message: 'duplicate event key' })
    seenEventKeys.add(e.key)
    issues.push(...validateEvent(e, subjectKeys))
  }

  const seenActionKeys = new Set<string>()
  for (const a of catalog.actions) {
    if (seenActionKeys.has(a.key)) issues.push({ path: `action:${a.key}`, message: 'duplicate action key' })
    seenActionKeys.add(a.key)
    issues.push(...validateAction(a))
  }

  // Every law an action references must be documented for the UI to explain it.
  const documented = new Set(catalog.laws.map((l) => l.key))
  for (const a of catalog.actions) {
    for (const law of a.laws ?? []) {
      if (inSet(LAW_KEYS, law) && !documented.has(law)) {
        issues.push({ path: `action:${a.key}.laws`, message: `law "${law}" is not documented in the law catalog` })
      }
    }
  }

  return issues
}
