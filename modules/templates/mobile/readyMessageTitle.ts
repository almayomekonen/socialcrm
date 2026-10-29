/**
 * Presentation-only title for Ready Messages.
 *
 * Meta-synced rows can land with `displayTitle = name` (e.g. `lead_first_contact`)
 * because `upsertFromMeta` falls back to the machine name. That identifier is a
 * WhatsApp slug, not a label. Known slugs are mapped from their actual meaning
 * in this product; unknown slugs never leak into the UI.
 *
 * Owner-authored Hebrew titles pass through unchanged. Stored values are not
 * rewritten — only what the phone renders.
 */

import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { MessageKey } from '@/lib/i18n/translate'

const HEBREW = /[\u0590-\u05FF]/
const SLUG = /^[a-z0-9]+(?:_[a-z0-9]+)*$/i

/**
 * Inspected meanings — not a blind underscore-to-words translation. The labels
 * are ours (`inbox.mobile.readyTitle.*`, Hebrew unchanged); `locale` defaults to
 * Hebrew, so the settings workspace that calls without one is unchanged.
 */
const KNOWN_SLUGS: Record<string, MessageKey> = {
  lead_first_contact: 'inbox.mobile.readyTitle.lead_first_contact',
  follow_up: 'inbox.mobile.readyTitle.follow_up',
  ready_message: 'inbox.mobile.readyTitle.ready_message',
}

export function readyMessageTitle(displayTitle: string | null | undefined, locale: UiLocale = 'he'): string {
  const t = translatorFor(locale)
  const fallback = t('inbox.mobile.readyTitle.ready_message')
  const title = (displayTitle ?? '').trim()
  if (!title) return fallback
  if (HEBREW.test(title) || /\s/.test(title)) return title

  const slug = title.toLowerCase()
  if (KNOWN_SLUGS[slug]) return t(KNOWN_SLUGS[slug])
  const base = slug.replace(/_\d+$/, '')
  if (KNOWN_SLUGS[base]) return t(KNOWN_SLUGS[base])
  if (SLUG.test(title)) return fallback
  return title
}
