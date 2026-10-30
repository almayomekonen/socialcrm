import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey, Translator } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'
import type { ActionDefinition, EventDefinition, FieldDefinition, IntegrationDefinition, ParameterDefinition, Requirement, SubjectDefinition } from './catalog/types'
import type { ConditionOperator } from './catalog/vocabularies'
import { ACTION, EVENT, FIELD, IDENTITY, INTEGRATION, OPERATOR, OPTION, PARAM, REQUIREMENT, SKIP, SUBJECT } from './catalogI18nKeys'
import { FAILURE_COPY, SKIP_REASON_COPY, TIMING_ACCURACY_COPY } from './copy'
import { IDENTITY_PROBLEM_COPY, type IdentityProblem } from './identity'
import { OPERATOR_LABELS, describeCondition, findField, operatorNeedsValue, type Condition } from './conditions'
import { automationSentence, timingPhrase } from './sentence'
import type { Timing } from './timing'
import type { SkipReason } from './types'

/**
 * The automations catalog in the interface language (Phase E5b) — DISPLAY ONLY.
 *
 * Every producer is the IDENTITY in Hebrew: it returns the catalog's own
 * object or constant (`localizeEvent(e, 'he') === e`), so Hebrew output is
 * unchanged. Other languages copy the definition with its words looked up by
 * CODE (event / action / subject / field / option / parameter / requirement /
 * integration key, operator, skip reason, identity problem). Keys, values,
 * option values and every code stay as they are, and nothing that validates,
 * emits, executes or stores reads these copies. An unknown code keeps the
 * catalog's word. Variable TOKENS are never localized (they are what is stored
 * and substituted) — only a chip's label is (`fieldLabelIn`).
 */

const word = (t: Translator, key: MessageKey | undefined, fallback: string) => (key ? t(key) : fallback)

function localizeField(field: FieldDefinition, t: Translator): FieldDefinition {
  const options = OPTION[field.key]
  return {
    ...field,
    label: word(t, FIELD[field.key], field.label),
    ...(field.options ? { options: field.options.map((o) => ({ ...o, label: word(t, options?.[o.value], o.label) })) } : {}),
  }
}

function localizeParameter(p: ParameterDefinition, t: Translator): ParameterDefinition {
  const keys = PARAM[p.key]
  return { ...p, label: word(t, keys?.label, p.label), ...(p.help !== undefined ? { help: word(t, keys?.help, p.help) } : {}) }
}

/** A requirement with its CTA label in `locale` (Hebrew: the requirement itself). */
export function localizeRequirement<R extends Requirement | null>(req: R, locale: UiLocale = 'he'): R {
  if (!req || locale === 'he' || !req.cta) return req
  return { ...req, cta: { ...req.cta, label: word(translatorFor(locale), REQUIREMENT[req.key], req.cta.label) } }
}

/** An event with its title, description, fields, options, parameters and requirement CTAs in `locale`. */
export function localizeEvent(event: EventDefinition | null, locale: UiLocale = 'he'): EventDefinition | null {
  if (!event || locale === 'he') return event
  const t = translatorFor(locale)
  const keys = EVENT[event.key]
  return {
    ...event,
    title: word(t, keys?.title, event.title),
    description: word(t, keys?.description, event.description),
    fields: event.fields.map((f) => localizeField(f, t)),
    parameters: event.parameters.map((p) => localizeParameter(p, t)),
    requirements: event.requirements.map((r) => localizeRequirement(r, locale)),
  }
}

/** An action with its title, description and parameters in `locale`. */
export function localizeAction(action: ActionDefinition | null, locale: UiLocale = 'he'): ActionDefinition | null {
  if (!action || locale === 'he') return action
  const t = translatorFor(locale)
  const keys = ACTION[action.key]
  return {
    ...action,
    title: word(t, keys?.title, action.title),
    description: word(t, keys?.description, action.description),
    parameters: action.parameters.map((p) => localizeParameter(p, t)),
    requirements: action.requirements.map((r) => localizeRequirement(r, locale)),
  }
}

export function localizeSubject(subject: SubjectDefinition, locale: UiLocale = 'he'): SubjectDefinition {
  return locale === 'he' ? subject : { ...subject, title: word(translatorFor(locale), SUBJECT[subject.key], subject.title) }
}

export function localizeIntegration(integration: IntegrationDefinition, locale: UiLocale = 'he'): IntegrationDefinition {
  return locale === 'he' ? integration : { ...integration, title: word(translatorFor(locale), INTEGRATION[integration.key], integration.title) }
}

/** An event title by event KEY (the connections page lists unlocked events by key + catalog title). */
export const eventTitleIn = (key: string, title: string, locale: UiLocale = 'he') =>
  locale === 'he' ? title : word(translatorFor(locale), EVENT[key]?.title, title)

/** A field's label by FIELD key — a variable chip's label (its token stays the stored Hebrew word). */
export const fieldLabelIn = (fieldKey: string, label: string, locale: UiLocale = 'he') =>
  locale === 'he' ? label : word(translatorFor(locale), FIELD[fieldKey], label)

export const operatorLabelIn = (op: ConditionOperator, locale: UiLocale = 'he') =>
  locale === 'he' ? OPERATOR_LABELS[op] : word(translatorFor(locale), OPERATOR[op], OPERATOR_LABELS[op])

/** `SKIP_REASON_COPY[reason]` in `locale`; undefined for a reason the map does not know (as before). */
export function skipReasonIn(reason: string, locale: UiLocale = 'he'): string | undefined {
  const he = SKIP_REASON_COPY[reason as SkipReason]
  return locale === 'he' || !he ? he : translatorFor(locale)(SKIP[reason as SkipReason])
}

export const failureIn = (kind: keyof typeof FAILURE_COPY, locale: UiLocale = 'he') =>
  locale === 'he' ? FAILURE_COPY[kind] : translatorFor(locale)(kind === 'terminal' ? 'admin.automationCatalog.failure.terminal' : 'admin.automationCatalog.failure.transient')

export const timingAccuracyIn = (locale: UiLocale = 'he') => (locale === 'he' ? TIMING_ACCURACY_COPY : translatorFor(locale)('admin.automationCatalog.accuracy'))

/** `IDENTITY_PROBLEM_COPY[problem]` in `locale`; undefined for an unknown problem (as before). */
export function identityProblemIn(problem: string, locale: UiLocale = 'he'): string | undefined {
  const he = IDENTITY_PROBLEM_COPY[problem as IdentityProblem]
  return locale === 'he' || !he ? he : translatorFor(locale)(IDENTITY[problem as IdentityProblem])
}

/** `timingPhrase` in `locale` (Hebrew: `timingPhrase` itself). */
export function timingPhraseIn(timing: Timing, locale: UiLocale = 'he'): string {
  if (locale === 'he') return timingPhrase(timing)
  const t = translatorFor(locale)
  if (timing.kind === 'preset') {
    if (timing.preset === 'immediate') return t('admin.automationCatalog.timing.immediate')
    return t(timing.preset === 'one_hour' ? 'admin.automationCatalog.timing.afterHours' : 'admin.automationCatalog.timing.afterDays', { count: 1 })
  }
  return t(timing.unit === 'hours' ? 'admin.automationCatalog.timing.afterHours' : 'admin.automationCatalog.timing.afterDays', { count: timing.value })
}

/** `describeCondition` in `locale`: the field and its option by key, the operator by code; a typed value as typed. */
export function describeConditionIn(event: EventDefinition, c: Condition, locale: UiLocale = 'he'): string {
  if (locale === 'he') return describeCondition(event, c)
  const t = translatorFor(locale)
  const field = findField(event, c.field)
  const label = field ? fieldLabelIn(field.key, field.label, locale) : c.field
  const operator = operatorLabelIn(c.operator, locale)
  if (!operatorNeedsValue(c.operator)) return t('admin.automationCatalog.sentence.conditionNoValue', { field: label, operator })
  const option = field?.options?.find((o) => o.value === c.value)
  const value = option ? word(t, OPTION[field!.key]?.[option.value], option.label) : c.value
  return t('admin.automationCatalog.sentence.condition', { field: label, operator, value })
}

/** `automationSentence` in `locale`. The subject is the business's own text and stays as written. */
export function automationSentenceIn(
  input: { event: EventDefinition | null; conditions: readonly Condition[]; actionTitle: string; subject: string; timing: Timing },
  locale: UiLocale = 'he',
): string {
  if (locale === 'he') return automationSentence(input)
  const t = translatorFor(locale)
  const parts = [input.event ? eventTitleIn(input.event.key, input.event.title, locale) : t('admin.automationCatalog.event.unknown')]
  if (input.event && input.conditions.length > 0) {
    const joined = input.conditions.map((c) => describeConditionIn(input.event!, c, locale)).join(t('admin.automationCatalog.sentence.and'))
    parts.push(t('admin.automationCatalog.sentence.onlyIf', { conditions: joined }))
  }
  parts.push(input.subject ? t('admin.automationCatalog.sentence.withSubject', { action: input.actionTitle, subject: input.subject }) : input.actionTitle)
  parts.push(timingPhraseIn(input.timing, locale))
  return parts.join(' · ')
}

/** The default action word when an automation's action is not in the catalog. */
export const actionFallbackIn = (locale: UiLocale = 'he') => (locale === 'he' ? 'פעולה' : translatorFor(locale)('admin.automationCatalog.action.fallback'))
