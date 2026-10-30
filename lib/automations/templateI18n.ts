import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'
import { localizeRequirement } from './catalogI18n'
import type { TemplateCategory, TemplateDefinition, TemplateVariable } from './templates/types'

/**
 * The automation-template marketplace in the interface language (Phase E5b) —
 * DISPLAY ONLY, the identity in Hebrew (`localizeTemplate(t, 'he') === t`).
 *
 * Other languages get a copy whose title, description, variable labels / help
 * / option labels and requirement CTAs are looked up by TEMPLATE KEY, variable
 * KEY and option VALUE. Keys, versions, option values, defaults and the
 * automations a template creates (their names, subjects, bodies, task titles —
 * the content installing stores) are never touched: installing reads the
 * registry, not this copy.
 */

type VariableKeys = { label: MessageKey; help?: MessageKey; options?: Record<string, MessageKey> }
type TemplateKeys = { title: MessageKey; description: MessageKey; variables?: Record<string, VariableKeys> }

const TEMPLATE: Record<string, TemplateKeys> = {
  website_lead_follow_up: {
    title: 'admin.automationTemplates.template.websiteLeadFollowUp.title',
    description: 'admin.automationTemplates.template.websiteLeadFollowUp.description',
    variables: {
      delayDays: {
        label: 'admin.automationTemplates.template.websiteLeadFollowUp.delayDays.label',
        options: { '1': 'admin.automationTemplates.template.websiteLeadFollowUp.delayDays.day1', '2': 'admin.automationTemplates.template.websiteLeadFollowUp.delayDays.day2' },
      },
    },
  },
  welcome_sequence: { title: 'admin.automationTemplates.template.welcomeSequence.title', description: 'admin.automationTemplates.template.welcomeSequence.description' },
  lost_lead_follow_up: { title: 'admin.automationTemplates.template.lostLeadFollowUp.title', description: 'admin.automationTemplates.template.lostLeadFollowUp.description' },
  contact_form_thank_you: { title: 'admin.automationTemplates.template.contactFormThankYou.title', description: 'admin.automationTemplates.template.contactFormThankYou.description' },
  appointment_reminder: {
    title: 'admin.automationTemplates.template.appointmentReminder.title',
    description: 'admin.automationTemplates.template.appointmentReminder.description',
    variables: {
      remindBefore: {
        label: 'admin.automationTemplates.template.appointmentReminder.remindBefore.label',
        options: { '1h': 'admin.automationTemplates.template.appointmentReminder.remindBefore.hour', '1d': 'admin.automationTemplates.template.appointmentReminder.remindBefore.day' },
      },
    },
  },
  internal_task_on_new_lead: {
    title: 'admin.automationTemplates.template.taskOnNewLead.title',
    description: 'admin.automationTemplates.template.taskOnNewLead.description',
    variables: { taskTitle: { label: 'admin.automationTemplates.template.taskOnNewLead.taskTitle.label', help: 'admin.automationTemplates.template.taskOnNewLead.taskTitle.help' } },
  },
  quote_on_lead_stage: {
    title: 'admin.automationTemplates.template.quoteOnLeadStage.title',
    description: 'admin.automationTemplates.template.quoteOnLeadStage.description',
    variables: {
      quoteTemplateId: { label: 'admin.automationTemplates.template.quoteOnLeadStage.quoteTemplateId.label', help: 'admin.automationTemplates.template.quoteOnLeadStage.quoteTemplateId.help' },
    },
  },
}

/** A variable token quoted in a help line (`{{שם הליד}}`) — what the business types, so it is kept as written. */
const TOKEN_IN_HELP = /\{\{[^{}]+\}\}/

function localizeVariable(variable: TemplateVariable, keys: VariableKeys | undefined, locale: UiLocale): TemplateVariable {
  if (!keys) return variable
  const t = translatorFor(locale)
  const token = variable.help?.match(TOKEN_IN_HELP)?.[0] ?? ''
  return {
    ...variable,
    label: t(keys.label),
    ...(variable.help !== undefined && keys.help ? { help: t(keys.help, { token }) } : {}),
    ...(variable.options ? { options: variable.options.map((o) => ({ ...o, label: keys.options?.[o.value] ? t(keys.options[o.value]) : o.label })) } : {}),
  }
}

export function localizeTemplate(template: TemplateDefinition, locale: UiLocale = 'he'): TemplateDefinition {
  if (locale === 'he') return template
  const keys = TEMPLATE[template.key]
  if (!keys) return { ...template, requirements: template.requirements.map((r) => localizeRequirement(r, locale)) }
  const t = translatorFor(locale)
  return {
    ...template,
    title: t(keys.title),
    description: t(keys.description),
    requirements: template.requirements.map((r) => localizeRequirement(r, locale)),
    variables: template.variables.map((v) => localizeVariable(v, keys.variables?.[v.key], locale)),
  }
}

const GALLERY_CATEGORY: Record<TemplateCategory, MessageKey> = {
  lead: 'admin.automationTemplates.category.lead',
  form: 'admin.automationTemplates.category.form',
  appointment: 'admin.automationTemplates.category.appointment',
  internal: 'admin.automationTemplates.category.internal',
}

/** The gallery's section heading (`CATEGORY` in components/settings/templates/copy.ts) in `locale`. */
export const galleryCategoryIn = (category: TemplateCategory, he: string, locale: UiLocale = 'he') =>
  locale === 'he' ? he : translatorFor(locale)(GALLERY_CATEGORY[category])
