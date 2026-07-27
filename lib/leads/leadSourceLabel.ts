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
 */

export type LeadSourceChannel = 'whatsapp' | 'facebook' | 'instagram' | 'manual'

const CHANNEL_LABEL: Record<LeadSourceChannel, string> = {
  whatsapp: 'WhatsApp',
  facebook: 'Facebook',
  instagram: 'Instagram',
  manual: 'ידני',
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

  // Known plain values (channel names + the manual synonyms).
  if (lower === 'whatsapp') return 'whatsapp'
  if (lower === 'facebook') return 'facebook'
  if (lower === 'instagram') return 'instagram'
  if (lower === 'manual' || trimmed === 'ידני') return 'manual'

  // Non-empty, unrecognized → free text (preserved by leadSourceLabel).
  return null
}

/**
 * User-facing label for a stored `leadSource`:
 *  - known channel (composite or plain) → localized channel label
 *  - null / undefined / empty → 'ידני'
 *  - unknown non-empty free text → preserved verbatim
 */
export function leadSourceLabel(source: string | null | undefined): string {
  const channel = leadSourceChannel(source)
  if (channel) return CHANNEL_LABEL[channel]
  // channel === null ⇒ source is a non-empty unrecognized value; keep it.
  return (source ?? '').trim() || 'ידני'
}

/**
 * The channel of a GENUINELY auto-ingested (webhook-created) lead: only the
 * composite `channel:externalId` form counts (`whatsapp:{id}`, `facebook:{id}`).
 * A plain/manual-declared value (e.g. a user picking "WhatsApp" in the create
 * form) was NOT captured automatically and returns null — distinct from
 * `leadSourceChannel`, which also maps plain values. Never infers Instagram from
 * `facebook:` (no heuristics). Used to decide whether the "arrived automatically"
 * lead-context surface should show.
 */
export function inboundChannelFromSource(source: string | null | undefined): LeadSourceChannel | null {
  if (typeof source !== 'string') return null
  const lower = source.trim().toLowerCase()
  if (lower.startsWith('whatsapp:')) return 'whatsapp'
  if (lower.startsWith('facebook:')) return 'facebook'
  if (lower.startsWith('instagram:')) return 'instagram'
  return null
}
