/**
 * Post-handoff responder (Wave 4). A lightweight, flag-gated helper that lets the
 * SAME assistant send a few brief replies AFTER a conversation is handed off
 * (aiState='escalated'): acknowledge, answer only from configured business
 * guidance, or politely defer to a human — until a human replies or the message
 * budget is spent. It restarts no qualification, runs no Runtime, adds no state.
 */
import { z } from 'zod'
import { runStructured } from '@/lib/ai/router'
import { db } from '@/config/db'
import { track } from '@/lib/analytics/track'
import { sendWhatsappText, formatWhatsappSendFailure } from '@/lib/whatsapp/sendMessage'
import { persistOutboundWhatsapp } from '@/lib/inbox/persistOutboundWhatsapp'
import { applyIreWhatsappSendFailure } from '@/lib/inbox/onWhatsappSendFailure'
import { resolveWhatsappAccessToken } from '@/lib/whatsapp/connectionToken'
import { skipAutoResponseJob, completeAutoResponseJob, type AutoResponseJob } from '@/db/autoResponseJobs'
import { upsertManyConversationIntelligence, getMaxMessageSequence, INTEL_KIND_TEMPERATURE } from '@/db/conversationIntelligence'
import { validateConciergeReply } from './validate'
import { waTrace } from './waTrace'
import type { QualifyCtx } from './qualifyWorker'

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

export type PostHandoffDecision =
  | { action: 'stop'; reason: string }
  | { action: 'send'; text: string; deferred: boolean }

/**
 * Pure decision for a post-handoff turn. Re-checks the turn-taking / window /
 * quiet-hours / daily-cap gates (which `escalated` short-circuited in
 * decidePreGeneration) plus the reply budget, then chooses the outgoing text:
 * the model's reply if it passes the concierge guardrail, otherwise a rotating
 * safe deferral (so repeated defers never read identically). No side effects.
 */
export function decidePostHandoffReply(input: {
  hasUnansweredInbound: boolean
  withinWindow: boolean
  withinQuietHours: boolean
  sentToday: number
  dailyCap: number
  budgetUsed: number
  gen: PostHandoffGen
}): PostHandoffDecision {
  if (!input.hasUnansweredInbound) return { action: 'stop', reason: 'no_pending_inbound' }
  if (!input.withinWindow) return { action: 'stop', reason: 'outside_window' }
  if (input.withinQuietHours) return { action: 'stop', reason: 'quiet_hours' }
  if (input.sentToday >= input.dailyCap) return { action: 'stop', reason: 'daily_cap' }
  if (input.budgetUsed >= maxPostHandoffMessages()) return { action: 'stop', reason: 'budget_exhausted' }
  if (input.gen.ok === false) return { action: 'stop', reason: input.gen.skipReason }

  const modelText = (input.gen.reply ?? '').trim()
  const modelValid = modelText.length > 0 && validateConciergeReply(modelText).ok
  if (!modelValid) return { action: 'send', text: deferLine(input.budgetUsed), deferred: true }
  return { action: 'send', text: modelText, deferred: input.gen.deferred }
}

export interface PostHandoffDeps {
  send: typeof sendWhatsappText
  generate: typeof generatePostHandoffReply
}

/** Send + persist a post-handoff outbound (tagged source=auto_response, reason=post_handoff). */
async function sendPostHandoff(
  job: AutoResponseJob,
  ctx: QualifyCtx,
  send: typeof sendWhatsappText,
  text: string,
): Promise<{ ok: true; messageId: number } | { ok: false; reason: string; settled?: true }> {
  const connection = await db('whatsapp_connections')
    .where({ phone_number_id: ctx.conv.businessPhoneNumberId, agency_id: job.agencyId })
    .first('phone_number_id', 'access_token', 'user_id')
  if (!connection) return { ok: false, reason: 'no_connection' }
  const to = ctx.conv.customerWaId
  if (!to) return { ok: false, reason: 'no_recipient' }

  const sentByUserId = ctx.lead.userId ?? ctx.lead.handlerId ?? connection.user_id
  const sent = await send({
    phoneNumberId: ctx.conv.businessPhoneNumberId,
    accessToken: resolveWhatsappAccessToken(connection.access_token),
    to,
    body: text,
    trace: { conversationId: ctx.conv.id, jobId: job.id, agencyId: job.agencyId, triggerSequence: job.triggerSequence },
  })
  if (sent.ok === false) {
    await applyIreWhatsappSendFailure(job, sent, {
      businessPhoneNumberId: ctx.conv.businessPhoneNumberId,
      customerWaId: to,
      customerName: ctx.conv.customerName ?? null,
      sentByUserId,
      text,
    })
    return { ok: false, reason: formatWhatsappSendFailure(sent), settled: true }
  }
  const res = await persistOutboundWhatsapp({
    agencyId: job.agencyId,
    leadId: job.leadId,
    businessPhoneNumberId: ctx.conv.businessPhoneNumberId,
    customerWaId: to,
    customerName: ctx.conv.customerName ?? null,
    sentByUserId,
    wamid: sent.wamid,
    text,
  })
  await db('inbox_messages')
    .where({ id: res.messageId })
    .update({ metadata: db.raw(`metadata || ?::jsonb`, [JSON.stringify({ source: 'auto_response', reason: 'post_handoff', phase: 2 })]) })
  return { ok: true, messageId: res.messageId }
}

/**
 * Orchestrate one post-handoff turn: telemetry, urgency prioritization, the pure
 * decision, then send/skip. Thin I/O around {@link decidePostHandoffReply}.
 */
export async function respondPostHandoff(args: {
  job: AutoResponseJob
  ctx: QualifyCtx
  deps: PostHandoffDeps
  recent: Transcript
  lastInbound?: { text: string }
  guidance: string | null
  sentToday: number
  dailyCap: number
  withinQuietHours: boolean
  withinWindow: boolean
  hasUnansweredInbound: boolean
  budgetUsed: number
}): Promise<'sent' | 'skipped' | 'failed'> {
  const { job, ctx, deps, recent, lastInbound, guidance, budgetUsed } = args
  const trace = { conversationId: ctx.conv.id, jobId: job.id, agencyId: job.agencyId, triggerSequence: job.triggerSequence }
  const urgent = detectUrgent(lastInbound?.text ?? '')
  waTrace('POST_HANDOFF_START', trace, { budgetUsed, budgetMax: maxPostHandoffMessages(), urgent })

  const stop = async (reason: string): Promise<'skipped'> => {
    await skipAutoResponseJob(job.id, reason)
    waTrace('POST_HANDOFF_STOP', trace, { reason, budgetUsed })
    await track({ agencyId: job.agencyId, event: 'post_handoff_stop', props: { conversationId: ctx.conv.id, reason } })
    return 'skipped'
  }

  // Urgency → raise inbox priority via the existing intelligence temperature (hot).
  // Best-effort; never blocks the reply, never changes qualification.
  if (urgent) {
    try {
      const coveredSequence = await getMaxMessageSequence(ctx.conv.id)
      await upsertManyConversationIntelligence([
        {
          conversationId: ctx.conv.id,
          agencyId: job.agencyId,
          channel: 'whatsapp',
          status: 'fresh',
          schemaVersion: 1,
          analyzerVersion: 'post-handoff-v1',
          coveredSequence,
          kind: INTEL_KIND_TEMPERATURE,
          data: { temperature: 'hot' },
        },
      ])
    } catch {
      // prioritization is best-effort
    }
  }

  const gen = await deps.generate({ agencyId: job.agencyId, transcript: recent, guidance })
  const decision = decidePostHandoffReply({
    hasUnansweredInbound: args.hasUnansweredInbound,
    withinWindow: args.withinWindow,
    withinQuietHours: args.withinQuietHours,
    sentToday: args.sentToday,
    dailyCap: args.dailyCap,
    budgetUsed,
    gen,
  })
  if (decision.action === 'stop') return stop(decision.reason)

  const r = await sendPostHandoff(job, ctx, deps.send, decision.text)
  if (r.ok === false) {
    if (r.settled) return 'failed'
    return stop(r.reason)
  }
  await completeAutoResponseJob(job.id, r.messageId)
  waTrace(decision.deferred ? 'POST_HANDOFF_DEFER' : 'POST_HANDOFF_REPLY', trace, {
    reply: decision.text,
    deferred: decision.deferred,
    urgent,
    budgetUsed: budgetUsed + 1,
    messageId: r.messageId,
  })
  await track({
    agencyId: job.agencyId,
    event: 'post_handoff_sent',
    props: { conversationId: ctx.conv.id, deferred: decision.deferred, urgent },
  })
  return 'sent'
}
