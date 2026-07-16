/**
 * Post-handoff responder (Wave 4). A lightweight, flag-gated helper that lets the
 * SAME assistant send a few brief replies AFTER a conversation is handed off
 * (aiState='escalated'): acknowledge, answer only from configured business
 * guidance, or politely defer to a human — until a human replies or the message
 * budget is spent. It restarts no qualification, runs no Runtime, adds no state.
 */
import { z } from 'zod'
import { runStructured } from '@/lib/ai/router'

/**
 * Per-agency canary flag, default OFF. Empty/unset allowlist → off everywhere.
 * POST_HANDOFF_KILL=1 is the global backstop.
 */
export function isPostHandoffEnabled(agencyId: number | null | undefined): boolean {
  const kill = process.env.POST_HANDOFF_KILL
  if (kill === '1' || kill === 'true') return false
  const raw = (process.env.POST_HANDOFF_AGENCY_IDS ?? '').trim()
  if (!raw) return false
  if (raw === 'all') return true
  if (!agencyId) return false
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter(Boolean)
    .includes(agencyId)
}

/** Max assistant replies allowed after handoff, per conversation. Default 3 (clamped 1..10). */
export function maxPostHandoffMessages(): number {
  const n = Number(process.env.MAX_POST_HANDOFF_MESSAGES)
  return Number.isFinite(n) && n >= 1 && n <= 10 ? Math.floor(n) : 3
}

const URGENT_PATTERNS: RegExp[] = [
  /דחוף|בהול|מייד|מיידי|עכשיו|תתקשרו אליי|תחזרו אליי מהר/, // Hebrew urgency
  /\burgent|asap|immediately|right now|call me now|emergency\b/i,
]

/** Deterministic urgency flag for a post-handoff inbound (prioritization only, never gates a reply). */
export function detectUrgent(text: string): boolean {
  return URGENT_PATTERNS.some((re) => re.test(text ?? ''))
}

/**
 * Safe defer fallbacks, rotated by reply count so we never send the exact same
 * deferral twice in a row. Each MUST pass validateConciergeReply (no price/time/
 * digits, ≤3 sentences). Used when the model can't answer from guidance or its
 * own reply fails validation.
 */
export const DEFER_VARIANTS = [
  'אחד מאנשי הצוות יחזור אליך עם המידע הזה בהקדם.',
  'נציג שלנו ישמח לענות לך על זה — הוא יחזור אליך בקרוב.',
  'את/ה בידיים טובות; איש צוות שלנו יענה לך על כך ממש בקרוב.',
]

/** Pick a defer variant by index (rotates), so repeated defers vary naturally. */
export function deferLine(index: number): string {
  return DEFER_VARIANTS[Math.abs(Math.trunc(index)) % DEFER_VARIANTS.length]
}

type Transcript = Array<{ direction: 'inbound' | 'outbound'; text: string }>

// Voice mirrored from the qualifier (Hebrew, first-person plural, warm/professional)
// so the customer feels they are still talking to the same assistant. The TASK is
// different: no qualification, no data collection — acknowledge / answer-from-
// guidance / defer. `deferred=true` only when it cannot answer from the guidance.
const POST_HANDOFF_SYSTEM = [
  'השיחה כבר הועברה לטיפול של נציג אנושי מהצוות. תפקידך: להמשיך את השיחה בעדינות עד שהנציג יחזור — לא לתשאל, לא לאסוף מידע, לא לפתוח מחדש את התהליך.',
  '- אל תשאל/י שאלות תשאול ואל תבקש/י פרטים.',
  '- אם הלקוח מודה או כותב משהו קצר — השב/י בחום ובקצרה, משפט אחד.',
  '- אם הלקוח שואל שאלה עסקית — ענה/י אך ורק מתוך "מידע העסק" שמסופק למטה. אם התשובה אינה שם או מחוץ לסמכותך — אל תמציא/י: קבע/י deferred=true והפנה/י בנימוס לנציג, בניסוח טבעי משלך.',
  '- אסור בתכלית: לנקוב במחיר/עלות/הנחה/זמינות/מועד/תור/פגישה; להבטיח או להתחייב; להמציא עובדה על העסק; לכתוב מספרים.',
  '- כתוב/כתבי בעברית, בגוף ראשון רבים, מקצועי וחם — באותו טון של השיחה עד כה. הודעה אחת קצרה בלבד.',
].join('\n')

export function buildPostHandoffUser(args: { transcript: Transcript; guidance: string | null }): string {
  const convo = args.transcript.map((m) => `${m.direction === 'inbound' ? 'לקוח' : 'אנחנו'}: ${m.text}`).join('\n')
  return [
    `שיחה עד כה:\n${convo || '(ריק)'}`,
    `מידע העסק (ענה/י אך ורק מתוכו; אם ריק — הפנה/י לנציג): ${args.guidance || '(לא סופק מידע — הפנה/י לנציג)'}`,
  ].join('\n\n')
}

const PostHandoffSchema = z.object({
  reply: z.string().describe('ההודעה הבאה ללקוח: משפט אחד קצר, חם, באותו טון'),
  deferred: z.boolean().describe('true אם אי אפשר לענות מתוך מידע העסק וצריך להפנות לנציג'),
})

export type PostHandoffGen =
  | { ok: true; reply: string; deferred: boolean }
  | { ok: false; skipReason: 'ai_unavailable' | 'budget_exhausted' }

/** One structured turn: acknowledge / answer-from-guidance / defer. No qualification. */
export async function generatePostHandoffReply(args: {
  agencyId: number
  transcript: Transcript
  guidance: string | null
}): Promise<PostHandoffGen> {
  const out = await runStructured({
    kind: 'inbox.autoResponse',
    schema: PostHandoffSchema,
    schemaName: 'PostHandoffTurn',
    system: POST_HANDOFF_SYSTEM,
    user: buildPostHandoffUser(args),
    agencyId: args.agencyId,
  })
  if (out.ok === false) {
    return { ok: false, skipReason: out.reason === 'over-quota' ? 'budget_exhausted' : 'ai_unavailable' }
  }
  const d = out.data as z.infer<typeof PostHandoffSchema>
  return { ok: true, reply: (d.reply ?? '').trim(), deferred: Boolean(d.deferred) }
}
