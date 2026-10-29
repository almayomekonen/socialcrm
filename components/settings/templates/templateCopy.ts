import type { Translator, MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'
import type { TemplateStatus } from '@/lib/whatsapp/templates/types'

/**
 * Ready-made message copy in the interface language (Phase E4). DISPLAY ONLY.
 *
 * The template actions, the validator and the stored `failureText` speak Hebrew
 * sentences with no code (lib/whatsapp/templates/messages.ts, the actions'
 * constants — all unchanged). Outside Hebrew a sentence is worded here by its
 * exact text; one we do not know (Meta's mapped errors, a future sentence) is
 * shown as returned. `settings.templates.*` in Hebrew equals those sentences
 * (pinned by a test), so Hebrew is the identity.
 */

const SENTENCE_KEYS: MessageKey[] = [
  'settings.templates.rejection.invalid_format',
  'settings.templates.rejection.policy',
  'settings.templates.rejection.content_mismatch',
  'settings.templates.rejection.generic',
  'settings.templates.validation.titleRequired',
  'settings.templates.validation.titleTooLong',
  'settings.templates.validation.bodyRequired',
  'settings.templates.validation.bodyTooLong',
  'settings.templates.validation.purposeRequired',
  'settings.templates.validation.unknownVariable',
  'settings.templates.validation.manualPlaceholder',
  'settings.templates.error.createPerm',
  'settings.templates.error.connect',
  'settings.templates.error.invalid',
  'settings.templates.error.managePerm',
  'settings.templates.error.notFound',
  'settings.templates.error.useDiscard',
  'settings.templates.error.useArchive',
  'settings.templates.error.notRetriable',
  'settings.templates.error.rateLimit',
  'settings.templates.error.deleteFailed',
]

const HEBREW = translatorFor('he')
const BY_SENTENCE = new Map<string, MessageKey>(SENTENCE_KEYS.map((key) => [HEBREW(key), key]))

/** A Hebrew sentence from the template actions / validator / stored rejection, in `t`'s language. */
export function templateSentence(text: string, t: Translator): string {
  if (t.locale === 'he') return text
  const key = BY_SENTENCE.get(text)
  return key ? t(key) : text
}

const STATUS_KEYS: Record<TemplateStatus, MessageKey> = {
  pending: 'settings.templates.status.pending',
  approved: 'settings.templates.status.approved',
  rejected: 'settings.templates.status.rejected',
  paused: 'settings.templates.status.paused',
  disabled: 'settings.templates.status.disabled',
}

export const templateStatusKey = (status: TemplateStatus): MessageKey | undefined => STATUS_KEYS[status]

/** The chip label of a variable TOKEN (the token itself is stored in the body and stays as it is). */
const VARIABLE_KEYS: Record<string, MessageKey> = {
  'שם הליד': 'settings.templates.variable.leadName',
  'שם העסק': 'settings.templates.variable.businessName',
}

export function variableLabel(token: string, t: Translator): string {
  const key = VARIABLE_KEYS[token]
  return t.locale === 'he' || !key ? token : t(key)
}
