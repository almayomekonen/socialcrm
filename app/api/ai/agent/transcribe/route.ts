import { NextRequest } from 'next/server'
import { AuthError, ProductAccessError, requireProductAccess } from '@/lib/requireUser'
import { isAgentEnabled } from '@/lib/ai/flags'
import { admitAiRun } from '@/lib/ai/gate'
import { addDailySpend } from '@/lib/ai/router/spend'
import {
  VOICE_MAX_UPLOAD_BYTES,
  VOICE_MIN_UPLOAD_BYTES,
  VOICE_TRANSCRIBE_TIMEOUT_MS,
  containerFromMimeType,
  sniffContainer,
} from '@/lib/agent/voice/limits'
import {
  VOICE_TRANSCRIPTION_CHARGE_USD,
  VoiceTranscriptionUnavailableError,
  transcribeVoice,
} from '@/lib/agent/voice/transcribe'

/**
 * POST /api/ai/agent/transcribe — /agent voice input: audio in, text out.
 *
 * THIS ROUTE CANNOT ACT. It returns a transcript and nothing else: no tool,
 * no action, no approval, no conversation write. The browser puts the text in
 * the composer; the rep reads it, edits it and presses send; and only then does
 * it travel the ordinary /agent path (stream route → askAgent → intent →
 * approval), with exactly the authority of typed text — which is none beyond
 * what the rep's words earn there.
 *
 * Same gates as asking the agent, in the same order:
 *   1. identity        requireProductAccess() — session + entitlement
 *   2. rollout         isAgentEnabled(agency)  — 404 outside AGENT_AGENCY_IDS
 *   3. AI admission    admitAiRun(agent.investigate) — AI_ENABLED, allowlist,
 *                      entitlement, provider presence, daily USD cap
 * then the audio's own checks: declared type, size, a byte-signature match,
 * one transcription at a time per user, a provider timeout.
 *
 * The body is the raw recording (Content-Type: audio/webm | audio/mp4 |
 * audio/ogg). No URL is ever accepted — there is nothing here that fetches.
 */

// Literal, as Next requires. The provider call is bounded well inside it.
export const maxDuration = 60

/** Longest transcript returned. Two minutes of speech is well under it. */
const MAX_TRANSCRIPT_CHARS = 4_000

/**
 * One transcription in flight per user, per server instance. The browser
 * already refuses a second one; this stops a scripted client from fanning out
 * paid provider calls from one session. (Cross-instance spend is bounded by
 * the daily cap.)
 */
const inFlight = new Set<number>()

function reply(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

/** Read the body, refusing it the moment it passes `limit` rather than after buffering all of it. */
async function readCapped(req: NextRequest, limit: number): Promise<Uint8Array | 'too-large'> {
  const reader = req.body?.getReader()
  if (!reader) return new Uint8Array(0)
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => {})
      return 'too-large'
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

export async function POST(req: NextRequest): Promise<Response> {
  // ── 1. Who is asking.
  let user
  try {
    user = await requireProductAccess()
  } catch (err) {
    if (err instanceof AuthError) return reply({ error: 'unauthorized' }, 401)
    if (err instanceof ProductAccessError) return reply({ error: 'forbidden' }, 403)
    console.error('[AGENT-TRANSCRIBE] auth failed:', (err as Error)?.message)
    return reply({ error: 'unavailable' }, 500)
  }

  // ── 2. Rollout — identical to /agent and the stream route.
  if (!isAgentEnabled(user.agencyId)) return reply({ error: 'agent-disabled' }, 404)

  // ── 3. The shared AI admission sequence, under the agent's own task.
  const admission = await admitAiRun({ kind: 'agent.investigate', agencyId: user.agencyId })
  // This repo's TS does not narrow on `.ok`; the in-operator reaches the failure member.
  if ('reason' in admission) {
    if (admission.reason === 'over-quota') return reply({ error: 'over-quota' }, 429)
    return reply({ error: 'ai-unavailable' }, 403)
  }

  // ── 4. What the client says it is sending. Checked before reading a byte.
  const declared = containerFromMimeType(req.headers.get('content-type'))
  if (!declared) return reply({ error: 'unsupported-audio' }, 415)

  const declaredLength = Number(req.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > VOICE_MAX_UPLOAD_BYTES) {
    return reply({ error: 'too-large' }, 413)
  }

  // ── 5. One at a time per user.
  if (inFlight.has(user.id)) return reply({ error: 'busy' }, 429)
  inFlight.add(user.id)
  try {
    const bytes = await readCapped(req, VOICE_MAX_UPLOAD_BYTES)
    if (bytes === 'too-large') return reply({ error: 'too-large' }, 413)
    if (bytes.byteLength < VOICE_MIN_UPLOAD_BYTES) return reply({ error: 'empty-audio' }, 422)

    // ── 6. What the bytes actually are. A relabelled arbitrary file stops here.
    const actual = sniffContainer(bytes)
    if (!actual || actual !== declared) return reply({ error: 'unsupported-audio' }, 415)

    // ── 7. The provider, bounded by its own timeout AND by the client leaving.
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(VOICE_TRANSCRIBE_TIMEOUT_MS)])
    let text: string
    try {
      ;({ text } = await transcribeVoice({ audio: bytes, container: actual, abortSignal: signal }))
    } catch (err) {
      if (err instanceof VoiceTranscriptionUnavailableError) return reply({ error: 'ai-unavailable' }, 503)
      const timedOut = signal.aborted && !req.signal.aborted
      // Never the provider's message: it can carry keys, model ids and request ids.
      console.error('[AGENT-TRANSCRIBE] provider failed:', timedOut ? 'timeout' : (err as Error)?.name ?? 'error')
      return reply({ error: timedOut ? 'timeout' : 'transcription-failed' }, timedOut ? 504 : 502)
    }

    // Charged once the provider has done the work, against the same daily cap
    // every other agency AI call counts toward.
    addDailySpend(user.agencyId, VOICE_TRANSCRIPTION_CHARGE_USD)

    if (!text) return reply({ error: 'no-speech' }, 422)
    return reply({ text: text.slice(0, MAX_TRANSCRIPT_CHARS) }, 200)
  } finally {
    inFlight.delete(user.id)
  }
}
