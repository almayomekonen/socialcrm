import { FACEBOOK_NOTICES, WHATSAPP_NOTICES, facebookNotice, whatsappHealthNotice, whatsappNotice, type ConnectionNotice } from '@/lib/connections/messages'
import { metaSignupErrorNextStep } from '@/lib/connections/metaSignupErrorSteps'
import { metaInboxNotice, type MetaInboxNoticeCode } from '@/lib/connections/metaNoticeCopy'
import { noticeForComposerHealth } from '@/lib/inbox/whatsappComposerDecision'
import type { WhatsappHealthPrimary } from '@/lib/whatsapp/operationalStatus'
import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * The Facebook / WhatsApp connection notices in the interface language
 * (Settings → Integrations, Phase E4). DISPLAY ONLY: Hebrew returns exactly what
 * `facebookNotice` / `whatsappNotice` / `whatsappHealthNotice` return (the
 * shared constants, read unchanged by the routes, the inbox and the mobile
 * screens). Another language gets the same notice — same code, `tone` and
 * reserved `secondary` — with its text from the catalog, chosen by the notice's
 * CODE (found by identity in the constants). Codes the inbox already words
 * reuse `metaInboxNotice` / `noticeForComposerHealth`. Meta's own error text is
 * shown as received.
 */

type Keys = { title: MessageKey; explanation: MessageKey; reasons: MessageKey[]; nextStep?: MessageKey; action?: MessageKey }

const FB_KEYS: Record<string, Keys> = {
  denied: { title: 'settings.fb.denied.title', explanation: 'settings.fb.denied.explanation', reasons: ['settings.fb.denied.reason1', 'settings.fb.denied.reason2'], nextStep: 'settings.fb.denied.nextStep', action: 'settings.fb.denied.action' },
  missing_permission: { title: 'settings.fb.missing_permission.title', explanation: 'settings.fb.missing_permission.explanation', reasons: ['settings.fb.missing_permission.reason1'], nextStep: 'settings.fb.missing_permission.nextStep', action: 'settings.fb.missing_permission.action' },
  no_page_selected: { title: 'settings.fb.no_page_selected.title', explanation: 'settings.fb.no_page_selected.explanation', reasons: ['settings.fb.no_page_selected.reason1'], nextStep: 'settings.fb.no_page_selected.nextStep', action: 'settings.fb.no_page_selected.action' },
  no_pages: { title: 'settings.fb.no_pages.title', explanation: 'settings.fb.no_pages.explanation', reasons: ['settings.fb.no_pages.reason1', 'settings.fb.no_pages.reason2', 'settings.fb.no_pages.reason3'], nextStep: 'settings.fb.no_pages.nextStep', action: 'settings.fb.no_pages.action' },
  no_pages_repeat: { title: 'settings.fb.no_pages_repeat.title', explanation: 'settings.fb.no_pages_repeat.explanation', reasons: ['settings.fb.no_pages_repeat.reason1', 'settings.fb.no_pages_repeat.reason2', 'settings.fb.no_pages_repeat.reason3'], nextStep: 'settings.fb.no_pages_repeat.nextStep', action: 'settings.fb.no_pages_repeat.action' },
  comments_permission: { title: 'settings.fb.comments_permission.title', explanation: 'settings.fb.comments_permission.explanation', reasons: ['settings.fb.comments_permission.reason1', 'settings.fb.comments_permission.reason2'], nextStep: 'settings.fb.comments_permission.nextStep', action: 'settings.fb.comments_permission.action' },
  pages_permission: { title: 'settings.fb.pages_permission.title', explanation: 'settings.fb.pages_permission.explanation', reasons: ['settings.fb.pages_permission.reason1'], nextStep: 'settings.fb.pages_permission.nextStep', action: 'settings.fb.pages_permission.action' },
  resource_claimed: { title: 'settings.fb.resource_claimed.title', explanation: 'settings.fb.resource_claimed.explanation', reasons: ['settings.fb.resource_claimed.reason1'], nextStep: 'settings.fb.resource_claimed.nextStep' },
  token: { title: 'settings.fb.token.title', explanation: 'settings.fb.token.explanation', reasons: ['settings.fb.token.reason1', 'settings.fb.token.reason2'], nextStep: 'settings.fb.token.nextStep', action: 'settings.fb.token.action' },
  state: { title: 'settings.fb.state.title', explanation: 'settings.fb.state.explanation', reasons: ['settings.fb.state.reason1', 'settings.fb.state.reason2'], nextStep: 'settings.fb.state.nextStep', action: 'settings.fb.state.action' },
  no_code: { title: 'settings.fb.no_code.title', explanation: 'settings.fb.no_code.explanation', reasons: ['settings.fb.no_code.reason1'], nextStep: 'settings.fb.no_code.nextStep', action: 'settings.fb.no_code.action' },
  subscription_failed: { title: 'settings.fb.subscription_failed.title', explanation: 'settings.fb.subscription_failed.explanation', reasons: ['settings.fb.subscription_failed.reason1', 'settings.fb.subscription_failed.reason2'], nextStep: 'settings.fb.subscription_failed.nextStep', action: 'settings.fb.subscription_failed.action' },
  selection_expired: { title: 'settings.fb.selection_expired.title', explanation: 'settings.fb.selection_expired.explanation', reasons: ['settings.fb.selection_expired.reason1'], nextStep: 'settings.fb.selection_expired.nextStep', action: 'settings.fb.selection_expired.action' },
  save_failed: { title: 'settings.fb.save_failed.title', explanation: 'settings.fb.save_failed.explanation', reasons: ['settings.fb.save_failed.reason1'], nextStep: 'settings.fb.save_failed.nextStep', action: 'settings.fb.save_failed.action' },
  repairing: { title: 'settings.fb.repairing.title', explanation: 'settings.fb.repairing.explanation', reasons: ['settings.fb.repairing.reason1'], nextStep: 'settings.fb.repairing.nextStep' },
}

const WA_KEYS: Record<string, Keys> = {
  not_completed: { title: 'settings.wa.not_completed.title', explanation: 'settings.wa.not_completed.explanation', reasons: ['settings.wa.not_completed.reason1', 'settings.wa.not_completed.reason2'], nextStep: 'settings.wa.not_completed.nextStep', action: 'settings.wa.not_completed.action' },
  meta_error: { title: 'settings.wa.meta_error.title', explanation: 'settings.wa.meta_error.explanation', reasons: [], nextStep: 'settings.wa.meta_error.nextStep', action: 'settings.wa.meta_error.action' },
  verification_incomplete: { title: 'settings.wa.verification_incomplete.title', explanation: 'settings.wa.verification_incomplete.explanation', reasons: ['settings.wa.verification_incomplete.reason1', 'settings.wa.verification_incomplete.reason2'], nextStep: 'settings.wa.verification_incomplete.nextStep', action: 'settings.wa.verification_incomplete.action' },
  sdk: { title: 'settings.wa.sdk.title', explanation: 'settings.wa.sdk.explanation', reasons: ['settings.wa.sdk.reason1', 'settings.wa.sdk.reason2'], nextStep: 'settings.wa.sdk.nextStep', action: 'settings.wa.sdk.action' },
  config: { title: 'settings.wa.config.title', explanation: 'settings.wa.config.explanation', reasons: [], nextStep: 'settings.wa.config.nextStep' },
  token: { title: 'settings.wa.token.title', explanation: 'settings.wa.token.explanation', reasons: ['settings.wa.token.reason1'], nextStep: 'settings.wa.token.nextStep', action: 'settings.wa.token.action' },
  network: { title: 'settings.wa.network.title', explanation: 'settings.wa.network.explanation', reasons: ['settings.wa.network.reason1'], nextStep: 'settings.wa.network.nextStep', action: 'settings.wa.network.action' },
  missing_details: { title: 'settings.wa.missing_details.title', explanation: 'settings.wa.missing_details.explanation', reasons: ['settings.wa.missing_details.reason1'], nextStep: 'settings.wa.missing_details.nextStep', action: 'settings.wa.missing_details.action' },
  no_accounts: { title: 'settings.wa.no_accounts.title', explanation: 'settings.wa.no_accounts.explanation', reasons: ['settings.wa.no_accounts.reason1', 'settings.wa.no_accounts.reason2'], nextStep: 'settings.wa.no_accounts.nextStep', action: 'settings.wa.no_accounts.action' },
  no_phones: { title: 'settings.wa.no_phones.title', explanation: 'settings.wa.no_phones.explanation', reasons: ['settings.wa.no_phones.reason1'], nextStep: 'settings.wa.no_phones.nextStep', action: 'settings.wa.no_phones.action' },
  subscribe_incomplete: { title: 'settings.wa.subscribe_incomplete.title', explanation: 'settings.wa.subscribe_incomplete.explanation', reasons: ['settings.wa.subscribe_incomplete.reason1', 'settings.wa.subscribe_incomplete.reason2'], nextStep: 'settings.wa.subscribe_incomplete.nextStep', action: 'settings.wa.subscribe_incomplete.action' },
  resource_claimed: { title: 'settings.wa.resource_claimed.title', explanation: 'settings.wa.resource_claimed.explanation', reasons: [], nextStep: 'settings.wa.resource_claimed.nextStep' },
}

const FB_REUSED = new Set<string>(['in_app_browser', 'expired', 'messenger_permission', 'messenger_declined', 'messenger_not_subscribed', 'comment_replies_permission', 'comment_replies_declined'])

/** WhatsApp notices the inbox composer already words, by the health status that shows them; plus their button labels. */
const WA_HEALTH: Record<string, { health: WhatsappHealthPrimary; action?: MessageKey }> = {
  not_ready: { health: 'registration_pending', action: 'settings.waAction.not_ready' },
  restricted: { health: 'restricted' },
  expired: { health: 'token', action: 'settings.waAction.expired' },
  webhook: { health: 'webhook', action: 'settings.waAction.webhook' },
  throttled: { health: 'throttled' },
  needs_verification: { health: 'unknown', action: 'settings.waAction.needs_verification' },
}

const codeOf = (notices: Record<string, ConnectionNotice>, notice: ConnectionNotice) => Object.keys(notices).find((k) => notices[k] === notice)

function worded(base: ConnectionNotice, keys: Keys | undefined, locale: UiLocale): ConnectionNotice {
  if (!keys) return base
  const t = translatorFor(locale)
  return {
    ...base,
    title: t(keys.title),
    explanation: t(keys.explanation),
    ...(base.reasons ? { reasons: keys.reasons.map((k) => t(k)) } : {}),
    ...(base.nextStep && keys.nextStep ? { nextStep: t(keys.nextStep) } : {}),
    ...(base.action && keys.action ? { action: t(keys.action) } : {}),
  }
}

/** One of `FACEBOOK_NOTICES` (as resolved by `facebookNotice` or read directly) in `locale`. */
export function localizeFacebookNotice(notice: ConnectionNotice | null, locale: UiLocale = 'he'): ConnectionNotice | null {
  if (!notice || locale === 'he') return notice
  const code = codeOf(FACEBOOK_NOTICES, notice)
  if (!code) return notice
  if (FB_REUSED.has(code)) return { ...metaInboxNotice(code as MetaInboxNoticeCode, locale), secondary: notice.secondary }
  return worded(notice, FB_KEYS[code], locale)
}

export function facebookNoticeFor(code: string | null | undefined, locale: UiLocale = 'he'): ConnectionNotice | null {
  return localizeFacebookNotice(facebookNotice(code), locale)
}

/** One of `WHATSAPP_NOTICES` in `locale`. */
export function localizeWhatsappNotice(notice: ConnectionNotice | null, locale: UiLocale = 'he'): ConnectionNotice | null {
  if (!notice || locale === 'he') return notice
  const code = codeOf(WHATSAPP_NOTICES, notice)
  if (!code) return notice
  if (code === 'in_app_browser') return metaInboxNotice('in_app_browser', locale)
  const reused = WA_HEALTH[code]
  if (reused) {
    const text = noticeForComposerHealth(reused.health, locale) ?? notice
    return { ...text, ...(notice.action && reused.action ? { action: translatorFor(locale)(reused.action) } : {}) }
  }
  return worded(notice, WA_KEYS[code], locale)
}

/** `whatsappNotice` in `locale`; a Meta error keeps Meta's own words and gets its documented next step. */
export function whatsappNoticeFor(code: string | null | undefined, metaMessage: string | null | undefined, locale: UiLocale = 'he'): ConnectionNotice | null {
  const notice = whatsappNotice(code, metaMessage)
  if (!notice || locale === 'he') return notice
  if (code === 'meta_error' && metaMessage) {
    const t = translatorFor(locale)
    const base = worded(WHATSAPP_NOTICES.meta_error, WA_KEYS.meta_error, locale)
    return { ...base, explanation: t('settings.metaShown', { message: metaMessage }), nextStep: metaSignupErrorNextStep(metaMessage, locale) ?? base.nextStep }
  }
  return localizeWhatsappNotice(notice, locale)
}

export function whatsappHealthNoticeFor(status: WhatsappHealthPrimary, locale: UiLocale = 'he'): ConnectionNotice | null {
  return localizeWhatsappNotice(whatsappHealthNotice(status), locale)
}
