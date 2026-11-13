import { db } from '@/config/db'
import { admitAiRun } from '@/lib/ai/gate'
import { addDailySpend } from '@/lib/ai/router/spend'
import { TRANSCRIPTION_USD_PER_MINUTE } from '@/lib/ai/usage/pricing'
import { probeAudioDurationMs } from '@/lib/agent/voice/audioDuration'
import { resolveWhatsappAccessToken } from '@/lib/whatsapp/connectionToken'
import { getAgencyName } from '@/db/automations/leadFacts'
import { downloadVoiceNote as download } from './downloadVoiceNote'
import {
  VOICE_NOTE_MAX_MS,
  VOICE_NOTE_MEDIA_TYPE,
  VOICE_NOTE_MIN_BYTES,
  VOICE_NOTES_PER_TURN,
  VOICE_MIN_STEP_MS,
  VOICE_TRANSCRIBE_TIMEOUT_MS,
  VOICE_TRANSCRIPT_MAX_CHARS,
  VOICE_TURN_BUDGET_MS,
  customerVoicePrompt,
  isMeaningfulTranscript,
  sniffVoiceNote,
  voiceMediaIdOf,
  type VoiceTranscription,
} from './voiceNote'

/**
 * Understand the customer's pending voice notes before the agent's turn reads
 * its facts (../autoresponse/qualifyWorker.ts). Each result is written onto the
 * audio message's own row, so the turn — and every later turn — reads the words
 * through the SAME pipeline as typed text. There is no voice agent.
 *
 * For EVERY agency the agent already serves. No allowlist, no agency id: the
 * only gates are the ones the agent's own reply already passes, checked here
 * before anything is downloaded or paid for:
 *   · the agency's auto-response is on (master + channel),
 *   · the AI admission gate for the agent's task (`inbox.autoResponse`): AI
 *     enabled, plan entitlement, a configured provider, the daily USD cap.
 *
 * Idempotent: a row that already carries a result is never sent to the
 * provider again, and the write is conditional on there being none yet, so a
 * retried job or a second job on the same conversation cannot overwrite it.
 * A duplicate webhook never gets here: its row is not re-inserted and no job is
 * enqueued (ingestWhatsappInbound).
 *
 * Never fabricates: a recording that could not be downloaded, is not a format
 * the provider takes, is too long, or came back with no words is recorded as
 * NOT understood. The turn then asks the customer to resend or write it
 * (reliability/silence.ts), and no reply is ever based on it.
 *
 * Nothing but the transcript is stored. The audio lives in this function's
 * memory only.
 */

export const VOICE_FEATURE = 'whatsapp.voice.transcribe'

/** Charged against the agency's daily AI cap per transcription: the length cap, the safe direction for a spend cap. */
export const VOICE_NOTE_CHARGE_USD = (VOICE_NOTE_MAX_MS / 60_000) * TRANSCRIPTION_USD_PER_MINUTE

export type TranscribeFn = (input: {
  audio: Uint8Array
  abortSignal: AbortSignal
  metadataDurationMs: number | null
  ledger: { agencyId: number; userId: number | null }
  use: { mediaType: string; prompt: string; feature: string; maxDurationMs: number }
}) => Promise<{ text: string }>

export type VoiceDeps = {
  fetch?: typeof fetch
  transcribe?: TranscribeFn
  /** The AI admission gate. Tests replace it; production uses admitAiRun. */
  admit?: (agencyId: number) => Promise<boolean>
  now?: () => Date
  /** Overrides VOICE_TURN_BUDGET_MS (tests). */
  budgetMs?: number
}

export type VoiceRunResult = { attempted: number; understood: number; skipped: 'none_pending' | 'auto_response_off' | 'ai_not_admitted' | 'provider_unavailable' | null }

class Unavailable extends Error {}

const MODEL = 'gpt-4o-transcribe'

async function defaultTranscribe(input: Parameters<TranscribeFn>[0]): Promise<{ text: string }> {
  const { transcribeVoice, VoiceTranscriptionUnavailableError } = await import('@/lib/agent/voice/transcribe')
  try {
    return await transcribeVoice(input)
  } catch (err) {
    if (err instanceof VoiceTranscriptionUnavailableError) throw new Unavailable()
    throw err
  }
}

async function defaultAdmit(agencyId: number): Promise<boolean> {
  const admission = await admitAiRun({ kind: 'inbox.autoResponse', agencyId })
  return !('reason' in admission)
}

type PendingRow = { id: number; type: string; payload: unknown; sequence: number }

/** Inbound audio after our last outbound, without a result yet. Agency AND conversation scoped. */
async function pendingVoiceNotes(agencyId: number, conversationId: number): Promise<PendingRow[]> {
  const lastOut = await db('inbox_messages')
    .where({ conversationId, agencyId, direction: 'outbound' })
    .max('sequence as seq')
    .first()
  const after = Number((lastOut as { seq?: unknown } | undefined)?.seq ?? 0) || 0
  const rows = (await db('inbox_messages')
    .where({ conversationId, agencyId, direction: 'inbound', type: 'audio' })
    .andWhere('sequence', '>', after)
    .whereRaw(`payload -> 'transcription' IS NULL`)
    .orderBy('sequence', 'desc')
    .limit(VOICE_NOTES_PER_TURN)
    .select('id', 'type', 'payload', 'sequence')) as PendingRow[]
  return rows.reverse()
}

/** First writer wins; a row that already has a result is left exactly as it is. */
async function persist(agencyId: number, conversationId: number, messageId: number, t: VoiceTranscription): Promise<void> {
  await db('inbox_messages')
    .where({ id: messageId, agencyId, conversationId, type: 'audio' })
    .whereRaw(`payload -> 'transcription' IS NULL`)
    .update({ payload: db.raw(`payload || jsonb_build_object('transcription', ?::jsonb)`, [JSON.stringify(t)]) })
}

export async function transcribePendingVoiceNotes(input: {
  agencyId: number
  conversationId: number
  businessPhoneNumberId: string
  autoResponseOn: boolean
  deps?: VoiceDeps
}): Promise<VoiceRunResult> {
  const { agencyId, conversationId } = input
  const pending = await pendingVoiceNotes(agencyId, conversationId)
  if (!pending.length) return { attempted: 0, understood: 0, skipped: 'none_pending' }
  // Nothing is downloaded or paid for where the agent is not going to answer anyway.
  if (!input.autoResponseOn) return { attempted: 0, understood: 0, skipped: 'auto_response_off' }
  if (!(await (input.deps?.admit ?? defaultAdmit)(agencyId))) return { attempted: 0, understood: 0, skipped: 'ai_not_admitted' }

  const now = () => (input.deps?.now?.() ?? new Date()).toISOString()
  const fail = (status: Exclude<VoiceTranscription['status'], 'ok'>, code: string, model: string | null = null): VoiceTranscription => ({ status, code, model, at: now() })

  // The token of the number THIS conversation is on, never another connection of the agency.
  const connection = (await db('whatsapp_connections')
    .where({ agency_id: agencyId, phone_number_id: input.businessPhoneNumberId })
    .first('access_token')) as { access_token?: string | null } | undefined
  const token = resolveWhatsappAccessToken(connection?.access_token)
  const f = input.deps?.fetch ?? fetch
  const transcribe = input.deps?.transcribe ?? defaultTranscribe
  const prompt = customerVoicePrompt(await getAgencyName(agencyId).catch(() => null))

  const deadline = Date.now() + (input.deps?.budgetMs ?? VOICE_TURN_BUDGET_MS)
  const remaining = () => deadline - Date.now()

  let attempted = 0
  let understood = 0
  // Newest first: the note the customer just sent matters most if time runs out.
  for (const row of [...pending].reverse()) {
    const mediaId = voiceMediaIdOf(row)
    let result: VoiceTranscription
    // Out of time: honestly not understood, so the customer is asked to write it (never redone on recovery).
    if (remaining() < VOICE_MIN_STEP_MS) result = fail('failed', 'turn_time_budget')
    else if (!mediaId) result = fail('failed', 'no_media_id')
    else if (!token) result = fail('failed', 'whatsapp_not_connected')
    else {
      const got = await download(f, mediaId, token, remaining)
      if (got.ok === false) result = fail(got.status, got.code)
      else if (got.bytes.byteLength < VOICE_NOTE_MIN_BYTES) result = fail('empty', 'too_small')
      else {
        const format = sniffVoiceNote(got.bytes)
        if (!format) result = fail('unsupported', 'unsupported_format')
        else {
          const declaredMs = format === 'mp3' ? null : probeAudioDurationMs(got.bytes, format)
          if (declaredMs != null && declaredMs > VOICE_NOTE_MAX_MS) result = fail('too_long', 'declared_too_long')
          else {
            attempted++
            try {
              const { text } = await transcribe({
                audio: got.bytes,
                abortSignal: AbortSignal.timeout(Math.max(1, Math.min(VOICE_TRANSCRIBE_TIMEOUT_MS, remaining()))),
                metadataDurationMs: declaredMs,
                // No user asked for this: the agency (and the job's operation) is the attribution.
                ledger: { agencyId, userId: null },
                use: { mediaType: VOICE_NOTE_MEDIA_TYPE[format], prompt, feature: VOICE_FEATURE, maxDurationMs: VOICE_NOTE_MAX_MS },
              })
              // Charged once the provider has done the work, against the same daily cap as the agent's reply.
              addDailySpend(agencyId, VOICE_NOTE_CHARGE_USD)
              const clean = String(text ?? '').trim().slice(0, VOICE_TRANSCRIPT_MAX_CHARS)
              result = isMeaningfulTranscript(clean) ? { status: 'ok', text: clean, model: MODEL, at: now() } : fail('empty', 'no_speech', MODEL)
            } catch (err) {
              if (err instanceof Unavailable) return { attempted: attempted - 1, understood, skipped: 'provider_unavailable' }
              // Never the provider's message: it can carry keys and request ids.
              const timedOut = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError'
              console.warn('[IRE-VOICE] transcription failed', { agencyId, conversationId, messageId: row.id, reason: timedOut ? 'timeout' : 'provider_error' })
              result = fail('failed', timedOut ? 'transcription_timeout' : 'transcription_failed', MODEL)
            }
          }
        }
      }
    }
    if (result.status === 'ok') understood++
    await persist(agencyId, conversationId, row.id, result)
  }
  return { attempted, understood, skipped: null }
}
