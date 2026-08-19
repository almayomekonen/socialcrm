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

const HEBREW = /[\u0590-\u05FF]/
const SLUG = /^[a-z0-9]+(?:_[a-z0-9]+)*$/i

/** Inspected meanings — not a blind underscore-to-words translation. */
const KNOWN_SLUGS: Record<string, string> = {
  lead_first_contact: 'יצירת קשר ראשוני',
  follow_up: 'מעקב',
  ready_message: 'הודעה מוכנה',
}

export function readyMessageTitle(displayTitle: string | null | undefined): string {
  const title = (displayTitle ?? '').trim()
  if (!title) return 'הודעה מוכנה'
  if (HEBREW.test(title) || /\s/.test(title)) return title

  const slug = title.toLowerCase()
  if (KNOWN_SLUGS[slug]) return KNOWN_SLUGS[slug]
  const base = slug.replace(/_\d+$/, '')
  if (KNOWN_SLUGS[base]) return KNOWN_SLUGS[base]
  if (SLUG.test(title)) return 'הודעה מוכנה'
  return title
}
