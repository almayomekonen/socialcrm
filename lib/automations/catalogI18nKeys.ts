import type { MessageKey } from '@/lib/i18n/translate'
import type { ConditionOperator } from './catalog/vocabularies'
import type { IdentityProblem } from './identity'
import type { SkipReason } from './types'

/**
 * The catalog's CODES → their catalog keys (Phase E5b), read by
 * `catalogI18n.ts`. Full key literals so `pnpm i18n:check` sees every one.
 * Split from catalogI18n.ts to keep both under the file-size soft limit.
 */

export const EVENT: Record<string, { title: MessageKey; description: MessageKey }> = {
  'lead.created': { title: 'admin.automationCatalog.event.leadCreated.title', description: 'admin.automationCatalog.event.leadCreated.description' },
  'lead.status_changed': { title: 'admin.automationCatalog.event.statusChanged.title', description: 'admin.automationCatalog.event.statusChanged.description' },
  'appointment.booked': { title: 'admin.automationCatalog.event.appointmentBooked.title', description: 'admin.automationCatalog.event.appointmentBooked.description' },
  'form.submitted': { title: 'admin.automationCatalog.event.formSubmitted.title', description: 'admin.automationCatalog.event.formSubmitted.description' },
}
export const SUBJECT: Record<string, MessageKey> = {
  lead: 'admin.automationCatalog.subject.lead',
  appointment: 'admin.automationCatalog.subject.appointment',
  form: 'admin.automationCatalog.subject.form',
}
export const FIELD: Record<string, MessageKey> = {
  leadFirstName: 'admin.automationCatalog.field.leadFirstName',
  businessName: 'admin.automationCatalog.field.businessName',
  repName: 'admin.automationCatalog.field.repName',
  email: 'admin.automationCatalog.field.email',
  phone: 'admin.automationCatalog.field.phone',
  status: 'admin.automationCatalog.field.status',
  source: 'admin.automationCatalog.field.source',
  newStatus: 'admin.automationCatalog.field.newStatus',
  meetingStatus: 'admin.automationCatalog.field.meetingStatus',
  meetingTitle: 'admin.automationCatalog.field.meetingTitle',
  meetingWhen: 'admin.automationCatalog.field.meetingWhen',
  meetingDetails: 'admin.automationCatalog.field.meetingDetails',
  startsAt: 'admin.automationCatalog.field.startsAt',
  appointmentName: 'admin.automationCatalog.field.appointmentName',
  formName: 'admin.automationCatalog.field.formName',
  message: 'admin.automationCatalog.field.message',
  pageUrl: 'admin.automationCatalog.field.pageUrl',
}
const LEAD_STATUS: Record<string, MessageKey> = {
  new: 'admin.automationCatalog.leadStatus.new',
  contacted: 'admin.automationCatalog.leadStatus.contacted',
  interested: 'admin.automationCatalog.leadStatus.interested',
  closed: 'admin.automationCatalog.leadStatus.closed',
  lost: 'admin.automationCatalog.leadStatus.lost',
}
/** Option words by FIELD key, then option VALUE (the value is what is stored and compared). */
export const OPTION: Record<string, Record<string, MessageKey>> = {
  status: LEAD_STATUS,
  newStatus: LEAD_STATUS,
  meetingStatus: {
    scheduled: 'admin.automationCatalog.meetingStatus.scheduled',
    cancelled: 'admin.automationCatalog.meetingStatus.cancelled',
    completed: 'admin.automationCatalog.meetingStatus.completed',
    no_show: 'admin.automationCatalog.meetingStatus.no_show',
  },
}
export const PARAM: Record<string, { label: MessageKey; help?: MessageKey }> = {
  formId: { label: 'admin.automationCatalog.param.formId.label', help: 'admin.automationCatalog.param.formId.help' },
  subject: { label: 'admin.automationCatalog.param.subject' },
  body: { label: 'admin.automationCatalog.param.body' },
  ctaLabel: { label: 'admin.automationCatalog.param.ctaLabel.label', help: 'admin.automationCatalog.param.ctaLabel.help' },
  ctaUrl: { label: 'admin.automationCatalog.param.ctaUrl' },
  title: { label: 'admin.automationCatalog.param.title' },
  templateId: { label: 'admin.automationCatalog.param.templateId.label', help: 'admin.automationCatalog.param.templateId.help' },
  templateBindings: { label: 'admin.automationCatalog.param.templateBindings' },
  quoteTemplateId: { label: 'admin.automationCatalog.param.quoteTemplateId.label', help: 'admin.automationCatalog.param.quoteTemplateId.help' },
}
export const REQUIREMENT: Record<string, MessageKey> = {
  website_connected: 'admin.automationCatalog.requirement.website',
  whatsapp_connected: 'admin.automationCatalog.requirement.messaging',
}
export const ACTION: Record<string, { title: MessageKey; description: MessageKey }> = {
  'email.send': { title: 'admin.automationCatalog.action.emailSend.title', description: 'admin.automationCatalog.action.emailSend.description' },
  'task.create': { title: 'admin.automationCatalog.action.taskCreate.title', description: 'admin.automationCatalog.action.taskCreate.description' },
  'whatsapp.send': { title: 'admin.automationCatalog.action.messageSend.title', description: 'admin.automationCatalog.action.messageSend.description' },
  'quote.create': { title: 'admin.automationCatalog.action.quoteCreate.title', description: 'admin.automationCatalog.action.quoteCreate.description' },
}
export const INTEGRATION: Record<string, MessageKey> = { contact_form_7: 'admin.automationCatalog.integration.website' }
export const OPERATOR: Record<ConditionOperator, MessageKey> = {
  is: 'admin.automationCatalog.operator.is',
  is_not: 'admin.automationCatalog.operator.is_not',
  contains: 'admin.automationCatalog.operator.contains',
  is_one_of: 'admin.automationCatalog.operator.is_one_of',
  equals: 'admin.automationCatalog.operator.equals',
  greater_than: 'admin.automationCatalog.operator.greater_than',
  less_than: 'admin.automationCatalog.operator.less_than',
  before: 'admin.automationCatalog.operator.before',
  after: 'admin.automationCatalog.operator.after',
  between: 'admin.automationCatalog.operator.between',
  exists: 'admin.automationCatalog.operator.exists',
  not_exists: 'admin.automationCatalog.operator.not_exists',
  is_true: 'admin.automationCatalog.operator.is_true',
  is_false: 'admin.automationCatalog.operator.is_false',
}
export const SKIP: Record<SkipReason, MessageKey> = {
  origin_import: 'admin.automationCatalog.skip.origin_import',
  lead_deleted: 'admin.automationCatalog.skip.lead_deleted',
  premise_expired: 'admin.automationCatalog.skip.premise_expired',
  suppressed: 'admin.automationCatalog.skip.suppressed',
  opted_out: 'admin.automationCatalog.skip.opted_out',
  no_email: 'admin.automationCatalog.skip.no_email',
  no_phone: 'admin.automationCatalog.skip.no_phone',
  address_undeliverable: 'admin.automationCatalog.skip.address_undeliverable',
  already_sent: 'admin.automationCatalog.skip.already_sent',
  lead_daily_cap: 'admin.automationCatalog.skip.lead_daily_cap',
  agency_daily_cap: 'admin.automationCatalog.skip.agency_daily_cap',
  quiet_hours: 'admin.automationCatalog.skip.quiet_hours',
  meeting_missing: 'admin.automationCatalog.skip.meeting_missing',
  meeting_cancelled: 'admin.automationCatalog.skip.meeting_cancelled',
  meeting_passed: 'admin.automationCatalog.skip.meeting_passed',
  action_unavailable: 'admin.automationCatalog.skip.action_unavailable',
}
export const IDENTITY: Record<IdentityProblem, MessageKey> = {
  no_sending_domain: 'admin.automationCatalog.identity.no_sending_domain',
  no_reply_to: 'admin.automationCatalog.identity.no_reply_to',
}
