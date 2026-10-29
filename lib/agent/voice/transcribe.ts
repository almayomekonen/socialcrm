import 'server-only'
import { getOpenAIProvider } from '@/lib/ai/providers'
import { errorCodeOf, newInvocationId, recordProviderCalls } from '@/lib/ai/usage/record'
import { TRANSCRIPTION_USD_PER_MINUTE } from '@/lib/ai/usage/pricing'
import { newCallId, settleShadowAfter, startShadow } from '@/lib/ai/budget/shadow'
import { estimateTranscription } from '@/lib/ai/budget/estimate'
import { VOICE_CONTAINER_MEDIA_TYPE, VOICE_MAX_RECORDING_MS, type VoiceContainer } from './limits'

/**
 * Speech-to-text for /agent voice input — audio in, text out, nothing else.
 *
 * Uses the SAME configured OpenAI provider as the rest of SocialCRM's AI
 * (`lib/ai/providers`), so there is no second key and no second provider.
 *
 * THE MODEL IS CALLED DIRECTLY, WITH AN EXPLICIT MEDIA TYPE. The SDK's
 * high-level `transcribe()` detects the format from a signature list that has
 * no WebM or MP4 entry and falls back to `audio/wav` — which names the upload
 * `audio.wav` and makes the provider reject exactly what Chrome (WebM) and
 * Safari (MP4) record. The route has already verified the container from the
 * bytes, so that verified type is passed through here.
 *
 * NOTHING IS STORED. The bytes live in this request's memory, go to the
 * provider, and are dropped when the request ends. No disk, no blob store,
 * no database row. The returned text only enters the conversation if the rep
 * sends it from the composer.
 */

/** Hebrew-first, handles code-switched Hebrew/English. */
export const VOICE_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe'

/**
 * Vocabulary hint, not an instruction to the model about behaviour. No
 * `language` is set on purpose: forcing `he` makes English product and lead
 * names come back transliterated, and reps mix the two in one sentence.
 */
const TRANSCRIPTION_PROMPT =
  'הקלטה קצרה של נציג מכירות בעברית, לעיתים עם מילים באנגלית, בתוך מערכת CRM: לידים, משימות, מעקבים, פגישות, וואטסאפ, SocialCRM.'

/** gpt-4o-transcribe list price: $0.006 per audio minute. */
const USD_PER_MINUTE = 0.006

/**
 * What one transcription is charged against the agency's daily AI cap.
 *
 * The provider does not report the audio's duration for this model, so the
 * charge is the MAXIMUM a recording can be. Over-counting a short clip is the
 * safe direction for a spend cap; under-counting is not.
 */
export const VOICE_TRANSCRIPTION_CHARGE_USD = (VOICE_MAX_RECORDING_MS / 60_000) * USD_PER_MINUTE

export class VoiceTranscriptionUnavailableError extends Error {
  constructor() {
    super('voice-transcription-unavailable')
  }
}

export async function transcribeVoice(input: {
  audio: Uint8Array
  container: VoiceContainer
  abortSignal?: AbortSignal
  /** Usage-ledger attribution. Identifiers only. */
  ledger?: { agencyId: number; userId: number }
}): Promise<{ text: string }> {
  const openai = getOpenAIProvider()
  if (!openai) throw new VoiceTranscriptionUnavailableError()

  const model = openai.transcription(VOICE_TRANSCRIPTION_MODEL)
  const startedAt = Date.now()
  const base = {
    invocationId: newInvocationId(),
    feature: 'voice.transcribe',
    provider: 'openai',
    requestedModel: VOICE_TRANSCRIPTION_MODEL,
    agencyId: input.ledger?.agencyId ?? null,
    userId: input.ledger?.userId ?? null,
    usage: null,
  }
  // Budget SHADOW: bounded by the recording cap; never delays the request.
  const shadow = startShadow({
    callId: newCallId(),
    agencyId: input.ledger?.agencyId ?? null,
    feature: 'voice.transcribe',
    provider: 'openai',
    model: VOICE_TRANSCRIPTION_MODEL,
    estimate: () => estimateTranscription(VOICE_MAX_RECORDING_MS),
  })
  let result: Awaited<ReturnType<typeof model.doGenerate>>
  try {
    result = await model.doGenerate({
      audio: input.audio,
      mediaType: VOICE_CONTAINER_MEDIA_TYPE[input.container],
      providerOptions: { openai: { prompt: TRANSCRIPTION_PROMPT } },
      abortSignal: input.abortSignal,
    })
  } catch (err) {
    await recordProviderCalls([
      {
        ...base,
        status: input.abortSignal?.aborted ? 'aborted' : 'error',
        errorCode: errorCodeOf(err),
        latencyMs: Date.now() - startedAt,
      },
    ])
    await settleShadowAfter(shadow, {
      outcome: 'error',
      usage: null,
      models: { requested: VOICE_TRANSCRIPTION_MODEL },
      knownCostUsd: null,
    })
    throw err
  }
  // Billed per audio minute. The reported duration prices it as an estimate;
  // without one the cost is unknown (never the flat 120 s cap-charge, never 0).
  const seconds = typeof result.durationInSeconds === 'number' && result.durationInSeconds >= 0 ? result.durationInSeconds : null
  await recordProviderCalls([
    {
      ...base,
      status: 'success',
      responseModel: result.response?.modelId ?? null,
      audioSeconds: seconds,
      estimatedCostUsd: seconds == null ? null : (seconds / 60) * TRANSCRIPTION_USD_PER_MINUTE,
      latencyMs: Date.now() - startedAt,
    },
  ])
  await settleShadowAfter(shadow, {
    outcome: 'success',
    usage: null,
    models: { requested: VOICE_TRANSCRIPTION_MODEL },
    knownCostUsd: seconds == null ? null : (seconds / 60) * TRANSCRIPTION_USD_PER_MINUTE,
  })
  return { text: String(result.text ?? '').trim() }
}
