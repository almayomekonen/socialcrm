import { FORBIDDEN, validateConciergeReply } from './validate'

/**
 * Deterministic warm handoff engine (Option B). Pure, no LLM, no provider, no I/O.
 * Assembles the customer-facing message for a QUALIFIED handoff from the fields
 * already known (name, need, urgency) plus the customer's original inbound message
 * (context). Returns text=null to signal the caller to fall back to the fixed
 * HANDOFF.qualified template — a message always sends.
 *
 * Tone: warm, concise, premium. Acknowledge the customer's situation WITHOUT
 * claiming expertise or making product-marketing claims. Reuses the existing
 * FORBIDDEN list / validateConciergeReply as a safety net (never modifies them).
 */

export type WarmTier = 'rich' | 'standard' | 'generic' | 'fallback'
export type NeedQuality = 'high' | 'medium' | 'low' | 'none'
export type NeedRejectedReason = 'empty' | 'too_short' | 'too_long' | 'forbidden' | 'low_quality' | null
export type FallbackReason = 'name_invalid' | 'validation_failed' | null

export interface WarmHandoffTelemetry {
  selectedTier: WarmTier
  needQuality: NeedQuality
  needAccepted: boolean
  needRejectedReason: NeedRejectedReason
  nameAccepted: boolean
  fallbackReason: FallbackReason
}
export interface WarmHandoffResult {
  text: string | null
  telemetry: WarmHandoffTelemetry
}

/** Per-agency canary flag, default OFF. WARM_HANDOFF_KILL=1 is the global backstop. */
export function isWarmHandoffEnabled(agencyId: number | null | undefined): boolean {
  const kill = process.env.WARM_HANDOFF_KILL
  if (kill === '1' || kill === 'true') return false
  const raw = (process.env.WARM_HANDOFF_AGENCY_IDS ?? '').trim()
  if (!raw) return false
  if (raw === 'all') return true
  if (!agencyId) return false
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter(Boolean)
    .includes(agencyId)
}

const NEED_MIN = 3
const NEED_MAX = 80
// A first message at/above this length reads as "detailed" → acknowledge the effort.
const EFFORT_MIN = 100

// Generic words that, on their own, carry no specific business problem → LOW quality.
const GENERIC_TERMS = [
  'מערכת', 'מערכות', 'עזרה', 'משהו', 'כלי', 'כלים', 'פתרון', 'פתרונות', 'תוכנה',
  'אפליקציה', 'פלטפורמה', 'שירות', 'crm', 'system', 'systems', 'help', 'tool',
  'tools', 'software', 'app', 'apps', 'something', 'platform', 'service', 'solution',
]
// Prefix-aware match (optional single Hebrew prefix ו/ה/ב/ל/מ/ש/כ), anchored — so
// "במערכת" counts as generic but real words like "לידים" are never mis-stripped.
const GENERIC_RE = GENERIC_TERMS.map((t) => new RegExp('^[והבלמשכ]?' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'))
// Connectors + vague qualifiers/interrogatives that are not meaningful content.
const STOPWORDS = new Set([
  'של', 'את', 'עם', 'כל', 'זה', 'זו', 'גם', 'או', 'אני', 'במקום', 'אחד', 'אחת',
  'יותר', 'דרך', 'כדי', 'לכל', 'איזה', 'אילו', 'מה', 'כזה', 'כלשהו',
])
const PAIN_RE = /עומס|דחוף|גבוה|לחץ|מיידי|נופל|קושי|overload|urgent|high|press/i

/**
 * No digits may be interpolated into a warm handoff, at all.
 *
 * This used to ride on FORBIDDEN's blanket `\d{2,}` rule. That rule has been
 * removed from the reply guardrail on purpose — a reply must be able to say
 * "מאזדה 3 משנת 2018" — but the two uses were never the same thing. Here we are
 * splicing an UNTRUSTED extracted value into a template the business appears to
 * have written, where a stray number reads as a price, a date or a phone number
 * the business never promised. So the rule lives here explicitly, scoped to
 * interpolation, rather than being inherited by accident from a list that is
 * about something else.
 */
const INTERPOLATION_DIGITS = /\d/

/** First given-name token, sanitized; null if unusable (empty / too long / digits / forbidden). */
function sanitizeName(raw: string | undefined): string | null {
  const t = (raw ?? '').trim().replace(/^["'«»[(]+|["'»«\])]+$/g, '')
  if (!t) return null
  const first = t.split(/\s+/)[0]
  if (first.length < 2 || first.length > 20) return null
  if (INTERPOLATION_DIGITS.test(first)) return null
  if (FORBIDDEN.some((re) => re.test(first))) return null
  return first
}

/** Light, meaning-preserving normalization of the free-text need. */
function normalizeNeed(raw: string | undefined): string {
  return (raw ?? '')
    .trim()
    .replace(/^["'«»[(]+|["'»«\])]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/, '')
    .replace(/^(אני\s+)?(מחפש(ת)?|רוצה|צריך(ה)?|מעוניין(ת)?)\s+/, '')
    .replace(/^מערכת ש/, '')
    .trim()
}

/** HIGH (>=3 content tokens) / MEDIUM (1-2) / LOW (0, all generic/filler) / none (empty). */
function classifyNeedQuality(normalized: string): NeedQuality {
  if (!normalized) return 'none'
  const tokens = normalized.split(/[\s,./\-—]+/).filter(Boolean)
  const content = tokens.filter((tok) => tok.length >= 2 && !STOPWORDS.has(tok) && !GENERIC_RE.some((re) => re.test(tok)))
  if (content.length === 0) return 'low'
  if (content.length >= 3) return 'high'
  return 'medium'
}

/** Validate + classify the need. Accepted only for HIGH/MEDIUM quality within guards. */
function assessNeed(normalized: string): { accepted: boolean; reason: NeedRejectedReason; quality: NeedQuality } {
  if (!normalized) return { accepted: false, reason: 'empty', quality: 'none' }
  if (normalized.length < NEED_MIN) return { accepted: false, reason: 'too_short', quality: classifyNeedQuality(normalized) }
  if (normalized.length > NEED_MAX) return { accepted: false, reason: 'too_long', quality: classifyNeedQuality(normalized) }
  if (INTERPOLATION_DIGITS.test(normalized) || FORBIDDEN.some((re) => re.test(normalized)))
    return { accepted: false, reason: 'forbidden', quality: classifyNeedQuality(normalized) }
  const quality = classifyNeedQuality(normalized)
  if (quality === 'low' || quality === 'none') return { accepted: false, reason: 'low_quality', quality }
  return { accepted: true, reason: null, quality }
}

// Deterministic message parts. No expertise/marketing claims. The opener varies by
// effort; the understanding sentence appends ONE generic pain acknowledgement.
const OPENER = {
  he: (n: string, effort: boolean) => (effort ? `תודה על הפירוט, ${n}!` : `תודה, ${n}!`),
  en: (n: string, effort: boolean) => (effort ? `Thanks for the detail, ${n}!` : `Thanks, ${n}!`),
}
// WhatsApp-natural punctuation: a colon introduces the need, a comma adds the pain
// acknowledgement (no em dashes). A tiny deterministic special case reflects "עומס"
// (overload) literally when it is the matched pain word — not a category map.
const UNDERSTAND = {
  he: (need: string, pain: boolean, overload: boolean) =>
    pain ? `מבינים את הצורך שתיארת: ${need}, ואת ${overload ? 'העומס' : 'הקושי'} שבזה.` : `מבינים את הצורך שתיארת: ${need}.`,
  en: (need: string, pain: boolean, overload: boolean) =>
    pain
      ? `We understand the need you described: ${need}, and the ${overload ? 'overload' : 'difficulty'} in it.`
      : `We understand the need you described: ${need}.`,
}
const CONNECT = {
  he: 'אני מחבר אותך לאחד מאנשי הצוות שלנו שיחזור אליך בהקדם.',
  en: `I'm connecting you with one of our team who'll get back to you shortly.`,
}
const GENERIC_BODY = {
  he: 'קלטנו את הפנייה שלך ואנחנו כבר על זה.',
  en: `We've got your message and we're on it.`,
}

/**
 * Build the deterministic warm handoff. Strictly for a QUALIFIED handoff — the
 * caller gates on escalationReason === 'qualified' and on isWarmHandoffEnabled.
 * `context` is the customer's original inbound message: pain is detected on it (not
 * only the urgency field), and a long/detailed message earns the effort opener.
 */
export function buildWarmHandoff(args: {
  name?: string
  need?: string
  urgency?: string
  context?: string
  lang: 'he' | 'en'
}): WarmHandoffResult {
  const name = sanitizeName(args.name)
  const nameAccepted = name !== null
  const needNorm = normalizeNeed(args.need)
  const need = assessNeed(needNorm)
  const ctx = (args.context ?? '').trim()
  // Pain from the original message OR the urgency field — not the urgency field alone.
  const painText = `${args.urgency ?? ''} ${args.need ?? ''} ${ctx}`
  const pain = PAIN_RE.test(painText)
  const overload = /עומס|overload/i.test(painText)
  const effort = ctx.length >= EFFORT_MIN

  const base = {
    needQuality: need.quality,
    needAccepted: need.accepted,
    needRejectedReason: need.reason,
    nameAccepted,
  }

  if (!nameAccepted) {
    return { text: null, telemetry: { ...base, selectedTier: 'fallback', fallbackReason: 'name_invalid' } }
  }

  const opener = OPENER[args.lang](name as string, effort)
  let tier: WarmTier
  let text: string
  if (need.accepted) {
    tier = pain ? 'rich' : 'standard'
    text = `${opener} ${UNDERSTAND[args.lang](needNorm, pain, overload)} ${CONNECT[args.lang]}`
  } else {
    tier = 'generic'
    text = `${opener} ${GENERIC_BODY[args.lang]} ${CONNECT[args.lang]}`
  }

  if (!validateConciergeReply(text).ok) {
    return { text: null, telemetry: { ...base, selectedTier: 'fallback', fallbackReason: 'validation_failed' } }
  }
  return { text, telemetry: { ...base, selectedTier: tier, fallbackReason: null } }
}
