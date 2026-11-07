import { LEGACY_DEFAULT_LOCALE, type UiLocale } from '@/lib/i18n/config'
import { CATALOGS } from '@/lib/i18n/messages'
import type { MessageKey, MessageParams } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'
import type { NotificationCategory, NotificationType } from '@/lib/notifications/types'
import { CATEGORY_LABEL } from './dropdown'

/**
 * READ-TIME DISPLAY of stored notification text (i18n Phase F3).
 *
 * `notifications.title` / `body` hold Hebrew rendered at emission time by the
 * deterministic builders in `lib/notifications/copy.ts`. Emission, the rows and
 * the feed query are untouched; the feed does not even carry `metadata`. So a
 * row is re-worded only from what it already holds — its `type` and its stored
 * sentence — and only when that is provably exact:
 *
 *   1. the type's candidate catalog sentences (TITLE_FORMS / BODY_FORMS, fixed
 *      sentences before patterns) are matched against the stored text, reading
 *      back the data in it: a name, a count, a provider label, a business name;
 *   2. the HEBREW catalog sentence, filled with those values, must reproduce the
 *      stored text byte for byte — checked here, per row, at runtime;
 *   3. only then is the same key rendered in the viewer's language, the data
 *      values inserted exactly as stored (names are never translated; a provider
 *      label is our own vocabulary and is).
 *
 * Anything else — a type with no forms (sla.*), legacy text an older emitter
 * wrote, free text, a provider this catalog does not know — is shown EXACTLY as
 * stored, flagged `verbatim` so the caller can declare it a Hebrew region.
 * Hebrew never goes through the catalog at all: it is always the stored text,
 * so it cannot drift. Pinned per type against the emitters' own copy
 * functions by __tests__/i18n/notificationsDisplayPin.test.ts.
 */

const k = (key: MessageKey) => key

export const TITLE_FORMS: Partial<Record<NotificationType, readonly MessageKey[]>> = {
  'lead.created': [k('notifications.content.title.leadCreated'), k('notifications.content.title.leadCreatedNamed')],
  'lead.hot': [k('notifications.content.title.leadHot'), k('notifications.content.title.leadHotNamed')],
  'lead.questionnaire_handoff': [
    k('notifications.content.title.questionnaireComplete'),
    k('notifications.content.title.questionnaireCompleteNamed'),
    k('notifications.content.title.waitingForRep'),
    k('notifications.content.title.waitingForRepNamed'),
  ],
  'lead.assigned': [k('notifications.content.title.leadAssigned'), k('notifications.content.title.leadAssignedNamed')],
  'lead.bulk_assigned': [
    k('notifications.content.title.leadsAssigned'),
    k('notifications.content.title.leadAssigned'),
    k('notifications.content.title.leadsAssignedCount'),
  ],
  'lead.status_changed': [k('notifications.content.title.statusChanged'), k('notifications.content.title.statusChangedNamed')],
  'lead.activity': [k('notifications.content.title.leadActivity'), k('notifications.content.title.leadActivityNamed')],
  'lead.insight': [k('notifications.content.title.insight'), k('notifications.content.title.insightNamed')],
  'lead.handoff': [k('notifications.content.title.waitingForRep'), k('notifications.content.title.waitingForRepNamed')],
  'message.inbound': [k('notifications.content.title.messageInbound'), k('notifications.content.title.messageInboundNamed')],
  'message.inbound_multiple': [k('notifications.content.title.messagesInbound'), k('notifications.content.title.messagesInboundNamed')],
  'message.unanswered': [k('notifications.content.title.messageUnanswered'), k('notifications.content.title.messageUnansweredNamed')],
  'message.messenger_inbound': [
    k('notifications.content.title.messengerInbound'),
    k('notifications.content.title.messengerInboundNamed'),
    k('notifications.content.title.messengerInboundCount'),
    k('notifications.content.title.messengerInboundCountNamed'),
  ],
  'comment.received': [k('notifications.content.title.comment'), k('notifications.content.title.commentNamed')],
  'followup.due': [k('notifications.content.title.followupDue'), k('notifications.content.title.followupDueNamed')],
  'followup.overdue': [k('notifications.content.title.followupWaiting'), k('notifications.content.title.followupWaitingNamed')],
  'integration.disconnected': [k('notifications.content.title.disconnected'), k('notifications.content.title.disconnectedProvider')],
  'integration.error': [k('notifications.content.title.connectionError'), k('notifications.content.title.connectionErrorProvider')],
  'integration.ingestion_failed': [k('notifications.content.title.leadNotSaved')],
  'subscription.cancellation_requested': [k('notifications.content.title.cancellation')],
  'followup.reminder_failed': [k('notifications.content.title.reminderFailed')],
  'followup.reminder_unconfirmed': [k('notifications.content.title.reminderUnconfirmed')],
}

/** Bodies. A type absent here writes no body; a stored body on it is shown verbatim. */
export const BODY_FORMS: Partial<Record<NotificationType, readonly MessageKey[]>> = {
  'lead.insight': [k('notifications.content.body.insight')],
  'integration.disconnected': [k('notifications.content.body.reconnect')],
  'integration.ingestion_failed': [k('notifications.content.body.leadNotSaved'), k('notifications.content.body.leadNotSavedProvider')],
  'subscription.cancellation_requested': [k('notifications.content.body.cancellation'), k('notifications.content.body.cancellationNamed')],
  'followup.reminder_failed': [k('notifications.content.body.reminderFailed'), k('notifications.content.body.reminderFailedAt')],
  'followup.reminder_unconfirmed': [k('notifications.content.body.reminderUnconfirmed'), k('notifications.content.body.reminderUnconfirmedAt')],
}

/** Registered types deliberately shown as stored: the disabled SLA placeholder ("SLA") has no meaning to word. */
export const VERBATIM_TYPES: readonly NotificationType[] = ['sla.approaching', 'sla.breached']

const PROVIDERS = ['facebook', 'whatsapp'] as const
type Provider = (typeof PROVIDERS)[number]
const PROVIDER_KEY: Record<Provider, MessageKey> = {
  facebook: 'notifications.content.provider.facebook',
  whatsapp: 'notifications.content.provider.whatsapp',
}

const CATEGORY_KEY: Record<NotificationCategory, MessageKey> = {
  leads: 'notifications.category.leads',
  messages: 'notifications.category.messages',
  followups: 'notifications.category.followups',
  sla: 'notifications.category.sla',
  integrations: 'notifications.category.integrations',
}

/** A category's label in `locale`. Hebrew is `CATEGORY_LABEL` itself (the registry of record). */
export function categoryLabelIn(category: NotificationCategory, locale: UiLocale = LEGACY_DEFAULT_LOCALE): string {
  if (locale === LEGACY_DEFAULT_LOCALE) return CATEGORY_LABEL[category]
  return translatorFor(locale)(CATEGORY_KEY[category])
}

// ── Matching ────────────────────────────────────────────────────────────────

const he = translatorFor(LEGACY_DEFAULT_LOCALE)
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function hebrewProviderLabel(p: Provider): string {
  return he(PROVIDER_KEY[p])
}

/** The Hebrew forms of `key` (one string, or each distinct plural form). */
function hebrewForms(key: MessageKey): string[] {
  let node: unknown = CATALOGS.he
  for (const part of key.split('.')) node = (node as Record<string, unknown>)[part]
  return typeof node === 'string' ? [node] : [...new Set(Object.values(node as Record<string, string>))]
}

const PLACEHOLDER = /\{(\w+)\}/g
const compiled = new Map<string, { re: RegExp; names: string[] }[]>()

function patternsFor(key: MessageKey) {
  let out = compiled.get(key)
  if (out) return out
  const providers = PROVIDERS.map((p) => escape(hebrewProviderLabel(p))).join('|')
  out = hebrewForms(key).map((form) => {
    const names: string[] = []
    const source = form
      .split(PLACEHOLDER)
      .map((part, i) => {
        if (i % 2 === 0) return escape(part)
        names.push(part)
        if (part === 'count') return '([1-9]\\d*)'
        if (part === 'provider') return `(${providers})`
        return '(.+)'
      })
      .join('')
    return { re: new RegExp(`^${source}$`, 's'), names }
  })
  compiled.set(key, out)
  return out
}

export type StoredMatch = { key: MessageKey; params: Record<string, string> }

/**
 * Which catalog sentence wrote `stored`, and the data it carries — or null.
 * A match counts only if the Hebrew catalog, filled with that data, gives back
 * `stored` exactly.
 */
export function matchStoredText(type: NotificationType, field: 'title' | 'body', stored: string): StoredMatch | null {
  const forms = (field === 'title' ? TITLE_FORMS : BODY_FORMS)[type]
  if (!forms) return null
  for (const key of forms) {
    for (const { re, names } of patternsFor(key)) {
      const m = re.exec(stored)
      if (!m) continue
      const params = Object.fromEntries(names.map((n, i) => [n, m[i + 1]]))
      if (he(key, params) === stored) return { key, params }
    }
  }
  return null
}

function providerCode(hebrewLabel: string): Provider | undefined {
  return PROVIDERS.find((p) => hebrewProviderLabel(p) === hebrewLabel)
}

export type ShownText = { text: string; verbatim: boolean }

/**
 * The text to show for a stored title / body in `locale`. Hebrew: the stored
 * text, always. Otherwise the re-worded sentence, or the stored text flagged
 * `verbatim` (the caller declares it Hebrew).
 */
export function storedTextIn(
  item: { type: NotificationType; title: string; body: string | null },
  field: 'title' | 'body',
  locale: UiLocale = LEGACY_DEFAULT_LOCALE,
): ShownText | null {
  const stored = field === 'title' ? item.title : item.body
  if (stored == null) return null
  if (locale === LEGACY_DEFAULT_LOCALE) return { text: stored, verbatim: false }
  const match = matchStoredText(item.type, field, stored)
  if (!match) return { text: stored, verbatim: true }
  const t = translatorFor(locale)
  const params: MessageParams = { ...match.params }
  if (match.params.provider) params.provider = t(PROVIDER_KEY[providerCode(match.params.provider)!])
  return { text: t(match.key, params), verbatim: false }
}
