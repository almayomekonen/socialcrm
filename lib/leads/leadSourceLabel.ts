/**
 * Presentation-time normalization of the stored `leadSource` value into a
 * user-facing label. PURE — no DB, no business logic, no side effects.
 *
 * The stored `leadSource` is a load-bearing COMPOSITE `channel:externalId` for
 * ingested leads (`whatsapp:{messageId}`, `facebook:{leadId}`) — it drives
 * webhook idempotency/dedup, the `clients_lead_source_unique` index, and
 * `isInboundSource` prefix detection. It MUST NOT be modified. This helper only
 * derives a clean display value at render/prompt time; the external-ID suffix of
 * a known integration source is never exposed.
 *
 * Instagram is intentionally NOT inferred from `facebook:` — current ingestion
 * stores both Facebook and Instagram leadgen as `facebook:{leadId}`, so only an
 * explicit `instagram:*` / plain "instagram" value ever displays as Instagram.
 *
 * Website ingestion stores `contact_form_7:{connectionRowId}:{submissionId}` —
 * the same composite convention, and equally internal. `contact_form_7` is the
 * historical integration key, kept deliberately (W1) because presentation is a
 * separate layer; this is where that separation is cashed in. The channel is
 * named `website`, not after the plugin, and displays as the same word the
 * manual create form already offers for it (`אתר`, types/lists.ts) — so a
 * hand-tagged website lead and an auto-ingested one read identically.
 */

import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { MessageKey } from '@/lib/i18n/translate'

export type LeadSourceChannel = 'whatsapp' | 'facebook' | 'instagram' | 'website' | 'manual'

const CHANNEL_KEY: Record<LeadSourceChannel, MessageKey> = {
  whatsapp: 'common.source.whatsapp',
  facebook: 'common.source.facebook',
  instagram: 'common.source.instagram',
  website: 'common.source.website',
  manual: 'common.source.manual',
}

/**
 * The canonical channel a stored source maps to, or `null` for a non-empty
 * unknown/free-text value. null/undefined/empty map to 'manual' (the existing
 * fallback). Also used to pick the source badge style. No heuristics.
 */
export function leadSourceChannel(source: string | null | undefined): LeadSourceChannel | null {
  if (source == null) return 'manual'
  const trimmed = source.trim()
  if (trimmed === '') return 'manual'

  const lower = trimmed.toLowerCase()

  // Known composite prefixes — never expose the external-ID suffix.
  if (lower.startsWith('whatsapp:')) return 'whatsapp'
  if (lower.startsWith('facebook:')) return 'facebook'
  if (lower.startsWith('instagram:')) return 'instagram'
  if (lower.startsWith('contact_form_7:')) return 'website'
  // Leads created by a rep from a Facebook comment or a Messenger conversation.
  // Their suffixes are Meta ids (comment id, Page id, Page-scoped user id) and
  // must never be displayed. Deliberately NOT in inboundChannelFromSource: they
  // were created by a person, not auto-ingested by a webhook.
  if (lower.startsWith('facebook_comment:') || lower.startsWith('messenger:')) return 'facebook'

  // Known plain values (channel names + the manual synonyms).
  if (lower === 'whatsapp') return 'whatsapp'
  if (lower === 'facebook') return 'facebook'
  if (lower === 'instagram') return 'instagram'
  if (lower === 'website' || trimmed === 'אתר') return 'website'
  if (lower === 'manual' || trimmed === 'ידני') return 'manual'

  // Non-empty, unrecognized → free text (preserved by leadSourceLabel).
  return null
}

/**
 * User-facing label for a stored `leadSource`:
 *  - known channel (composite or plain) → channel label (`common.source.*`)
 *  - null / undefined / empty → the manual label ('ידני')
 *  - unknown non-empty free text → preserved verbatim (external data, never translated)
 *
 * Labels are in the interface `locale`; Hebrew by default, which is what MCP,
 * AI prompts and the leads table get (they pass nothing).
 */
export function leadSourceLabel(source: string | null | undefined, locale: UiLocale = 'he'): string {
  const t = translatorFor(locale)
  const channel = leadSourceChannel(source)
  if (channel) return t(CHANNEL_KEY[channel])
  // channel === null ⇒ source is a non-empty unrecognized value; keep it.
  return (source ?? '').trim() || t('common.source.manual')
}

/**
 * The channel of a GENUINELY auto-ingested (webhook-created) lead: only the
 * composite `channel:externalId` form counts (`whatsapp:{id}`, `facebook:{id}`).
 * A plain/manual-declared value (e.g. a user picking "WhatsApp" in the create
 * form) was NOT captured automatically and returns null — distinct from
 * `leadSourceChannel`, which also maps plain values. Never infers Instagram from
 * `facebook:` (no heuristics). Used to decide whether the "arrived automatically"
 * lead-context surface should show.
 *
 * `contact_form_7:` is deliberately ABSENT. A website lead is genuinely
 * auto-ingested, but `InboundLeadContext` renders only Facebook and WhatsApp
 * variants — so claiming the channel here would detect a surface that does not
 * exist. Add it together with that view, not before it.
 */
export function inboundChannelFromSource(source: string | null | undefined): LeadSourceChannel | null {
  if (typeof source !== 'string') return null
  const lower = source.trim().toLowerCase()
  if (lower.startsWith('whatsapp:')) return 'whatsapp'
  if (lower.startsWith('facebook:')) return 'facebook'
  if (lower.startsWith('instagram:')) return 'instagram'
  return null
}
