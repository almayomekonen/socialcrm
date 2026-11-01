import { db } from '@/config/db'
import { activateByCode, optOutByPhone } from '@/db/ownerWhatsappRecipients'
import {
  countRecentRejectedActivations,
  hasOptOutAtOrAfter,
  recordPlatformInbound,
  setPlatformInboundKind,
} from '@/db/platformWhatsappInbound'
import { ownerWhatsappReminderAudience } from '@/lib/flags/ownerWhatsappReminderFlags'
import { parsePlatformStatus, recordPlatformStatus } from '@/db/platformWhatsappMessageStatus'
import { parsePlatformCommand } from './commands'
import { hashActivationCode, hashPlatformSender } from './keys'
import { enqueueWaAssistantJob } from '@/db/waAssistantJobs'
import {
  isWaAssistantAgency,
  isWaAssistantSenderGuidanceEnabled,
  waAssistantAgencyIds,
  WA_ASSISTANT_LIMITS,
} from '@/lib/flags/waAssistantFlags'
import { matchAssistantSender } from '@/lib/waAssistant/identity'
import { DECISION_ID_RE } from '@/lib/waAssistant/meetings/copy'
import { decideSenderGuidance, type SenderGuidance } from './senderGuidance'

/**
 * Inbound traffic to the SocialCRM platform number (not an agency's number).
 *
 * NEVER enters the agency pipeline: no conversation, message, lead, bot or
 * notification is created, and nothing is sent (this module makes no network
 * call). The one job it may create is a WhatsApp assistant job (step 4), for
 * the assistant's own worker; the reply happens there, never here. Delivery statuses are recorded by message id for the owner reminders
 * this number sends (`owner_whatsapp_message_status`, forward-only); every other
 * non-message field is ignored.
 *
 * ONE TRANSACTION PER MESSAGE, under a per-sender advisory lock:
 *   1. record the message id (a redelivery stops here, changing nothing);
 *   2. an opt-out updates the recipients in the same transaction;
 *   3. an activation is checked against the rate limit and any later opt-out,
 *      then consumes its code in one guarded statement;
 *   4. anything else, from a number verified for EXACTLY ONE active recipient
 *      in an agency with the assistant enabled, is queued for the assistant
 *      (WA_ASSISTANT_AGENCY_IDS; absent = nothing is queued, as before). Opt-out
 *      and activation always win: they are decided first and never queued.
 *      A sender it cannot answer may instead earn ONE fixed guidance reply
 *      (senderGuidance.ts; WA_ASSISTANT_SENDER_GUIDANCE), sent by the caller
 *      after commit — this module still makes no network call.
 * A failure rolls the whole message back, including step 1, so a redelivery
 * processes it again. The caller decides what to answer Meta.
 */

/** Advisory-lock namespace (int4), distinct from 12345 and 20261118..20261120. */
export const PLATFORM_SENDER_LOCK_NAMESPACE = 20261012
export const MAX_REJECTED_ACTIVATIONS_PER_HOUR = 5

export type PlatformMessageOutcome =
  | 'duplicate'
  | 'opted_out'
  | 'activated'
  | 'activation_rejected'
  | 'ignored'
  | 'skipped'
  | 'assistant_queued'
  | 'assistant_guidance'

/** A fixed reply to send AFTER the message's transaction committed (senderGuidance.ts). */
export type GuidanceReply = { toDigits: string; replyToWamid: string } & SenderGuidance

type Change = { field?: unknown; value?: { messages?: unknown; statuses?: unknown } & Record<string, unknown> }

const phoneDigits = (raw: unknown): string | null => (typeof raw === 'string' && /^[1-9]\d{7,14}$/.test(raw) ? raw : null)

function sentAt(raw: unknown): number | null {
  const n = typeof raw === 'string' && /^\d{1,12}$/.test(raw) ? Number(raw) : typeof raw === 'number' ? raw : NaN
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/**
 * `guidance` collects the fixed reply this message earned, if any — pushed only
 * once the transaction has committed, so a rolled-back message never sends one.
 */
export async function processPlatformMessage(message: Record<string, any>, guidance?: GuidanceReply[]): Promise<PlatformMessageOutcome> {
  const r = await decidePlatformMessage(message)
  if (r.guidance && guidance) guidance.push(r.guidance)
  return r.outcome
}

type Decided = { outcome: PlatformMessageOutcome; guidance?: GuidanceReply }

async function decidePlatformMessage(message: Record<string, any>): Promise<Decided> {
  const wamid = typeof message?.id === 'string' && message.id ? message.id : null
  if (!wamid) return { outcome: 'skipped' }

  const from = phoneDigits(message.from)
  const timestamp = sentAt(message.timestamp)
  const parsed = message.type === 'text' ? parsePlatformCommand(message.text?.body) : ({ kind: 'other' } as const)
  // Without a number there is nobody to opt out or bind; without Meta's send
  // time an activation cannot be ordered against an opt-out. An opt-out with no
  // send time is still honoured, as of now.
  const command = !from || (parsed.kind === 'activation' && timestamp === null) ? ({ kind: 'other' } as const) : parsed
  const messageTimestamp = timestamp ?? Math.floor(Date.now() / 1000)
  const fromHash = from ? hashPlatformSender(from) : null

  return db.transaction(async (trx): Promise<Decided> => {
    if (fromHash) {
      await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), ?)', [fromHash, PLATFORM_SENDER_LOCK_NAMESPACE])
    }
    const isNew = await recordPlatformInbound(trx, { wamid, kind: command.kind, fromHash, messageTimestamp })
    if (!isNew) return { outcome: 'duplicate' }

    if (command.kind === 'opt_out') {
      await optOutByPhone(trx, `+${from}`, messageTimestamp)
      return { outcome: 'opted_out' }
    }
    if (command.kind === 'other') {
      const routed = await routeToAssistant(trx, message, from, fromHash, messageTimestamp)
      if (routed === 'queued') return { outcome: 'assistant_queued' }
      if (routed && from) return { outcome: 'assistant_guidance', guidance: { toDigits: from, replyToWamid: wamid, ...routed } }
      return { outcome: 'ignored' }
    }
    if (command.kind !== 'activation' || !fromHash) return { outcome: 'ignored' }

    const rejected =
      (await countRecentRejectedActivations(trx, fromHash)) >= MAX_REJECTED_ACTIVATIONS_PER_HOUR ||
      (await hasOptOutAtOrAfter(trx, fromHash, messageTimestamp)) ||
      !(await activateByCode(trx, {
        codeHash: hashActivationCode(command.code),
        phoneE164: `+${from}`,
        messageTimestamp,
        agencyIds: ownerWhatsappReminderAudience(),
      }))
    if (!rejected) return { outcome: 'activated' }
    await setPlatformInboundKind(trx, wamid, 'activation_rejected')
    return { outcome: 'activation_rejected' }
  })
}

/** Media the assistant answers with a short "text only" note; anything else (reactions, system events) is ignored. */
const UNSUPPORTED_MEDIA = new Set(['audio', 'image', 'video', 'document', 'sticker', 'location', 'contacts'])

/** A tap on one of the assistant's own confirmation buttons; any other interactive payload is ignored. */
function decisionId(message: Record<string, any>): string | null {
  if (message.type !== 'interactive' || message.interactive?.type !== 'button_reply') return null
  const id = message.interactive?.button_reply?.id
  return typeof id === 'string' && DECISION_ID_RE.test(id) ? id : null
}

/** Queued for the assistant, a fixed guidance reply for a sender it cannot answer, or nothing. */
async function routeToAssistant(
  trx: Parameters<typeof enqueueWaAssistantJob>[0],
  message: Record<string, any>,
  from: string | null,
  fromHash: string | null,
  messageTimestamp: number,
): Promise<'queued' | SenderGuidance | null> {
  // Both off: no lookup at all, exactly as before.
  if (!from || (waAssistantAgencyIds().length === 0 && !isWaAssistantSenderGuidanceEnabled())) return null
  const isText = message.type === 'text' && typeof message.text?.body === 'string'
  const decision = decisionId(message)
  if (!isText && !decision && !UNSUPPORTED_MEDIA.has(String(message.type))) return null
  const match = await matchAssistantSender(trx, `+${from}`)
  if (match.kind === 'ambiguous') {
    console.log('[WhatsappWebhook][platform] assistant: number verified for several accounts; not answered', { count: match.count })
  }
  if (match.kind !== 'match' || !isWaAssistantAgency(match.agencyId)) {
    const guidance = await decideSenderGuidance(trx, { fromHash, wamid: message.id, match })
    if (guidance) console.log('[WhatsappWebhook][platform] assistant: guidance', { kind: guidance.kind })
    return guidance
  }
  const queued = await enqueueWaAssistantJob(trx, {
    wamid: message.id,
    recipientId: match.recipientId,
    agencyId: match.agencyId,
    userId: match.userId,
    kind: isText ? 'text' : decision ? 'decision' : 'unsupported',
    question: isText ? String(message.text.body).slice(0, WA_ASSISTANT_LIMITS.maxQuestionChars) : decision,
    messageTimestamp,
  })
  return queued ? 'queued' : null
}

/**
 * Every message in every platform change. Each message is independent: one
 * failure does not stop the others. `ok` is false when any message could not be
 * persisted, so the caller can ask Meta to redeliver (a redelivery repeats only
 * what was not saved; what was saved is a no-op by message id).
 */
export async function processPlatformChanges(
  changes: Change[],
): Promise<{ ok: boolean; failed: number; outcomes: PlatformMessageOutcome[]; guidance: GuidanceReply[] }> {
  const outcomes: PlatformMessageOutcome[] = []
  const guidance: GuidanceReply[] = []
  let failed = 0
  for (const change of changes) {
    if (change?.field !== 'messages') continue
    const statuses = Array.isArray(change.value?.statuses) ? (change.value.statuses as unknown[]) : []
    for (const raw of statuses) {
      const event = parsePlatformStatus(raw)
      if (!event) continue
      try {
        await recordPlatformStatus(event)
      } catch (err) {
        failed++
        console.error('[WhatsappWebhook][platform] status not saved', { code: (err as { code?: string })?.code ?? null })
      }
    }
    const messages = Array.isArray(change.value?.messages) ? (change.value.messages as Record<string, any>[]) : []
    for (const message of messages) {
      try {
        outcomes.push(await processPlatformMessage(message, guidance))
      } catch (err) {
        failed++
        console.error('[WhatsappWebhook][platform] message not saved', { code: (err as { code?: string })?.code ?? null })
      }
    }
  }
  return { ok: failed === 0, failed, outcomes, guidance }
}
