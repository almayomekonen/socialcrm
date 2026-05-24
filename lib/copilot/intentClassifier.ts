import { runStructured } from '@/lib/ai/router'
import {
  INTENT_CLASSIFICATION_SYSTEM_PROMPT,
  IntentClassificationSchema,
  type IntentClassification,
} from '@/lib/ai/prompts/intentClassification'
import type { Intent } from './intents'

const TIMEOUT_MS = 3000

export type LlmClassifyResult =
  | { ok: true; intent: Intent; confidence: number }
  | { ok: false; reason: 'disabled' | 'timeout' | 'failed' }

/**
 * LLM fallback for the rare case when the local classifier is uncertain
 * (confidence < 0.9). Wraps `runStructured` with a hard timeout and a
 * typed-failure return so the caller never has to `try/catch`.
 *
 * On any failure mode, the caller falls through to the CRM pipeline.
 */
export async function classifyIntentWithLLM(opts: {
  normalizedText: string
  userId: number
  agencyId: number
}): Promise<LlmClassifyResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<{ ok: false; reason: 'timeout' }>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), TIMEOUT_MS)
  })

  try {
    const runPromise = runStructured({
      kind: 'copilot.classifyIntent',
      schema: IntentClassificationSchema,
      schemaName: 'IntentClassification',
      schemaDescription: 'Light-weight intent classification for Copilot routing.',
      system: INTENT_CLASSIFICATION_SYSTEM_PROMPT,
      user: opts.normalizedText,
      userId: opts.userId,
      agencyId: opts.agencyId,
    })

    const result = await Promise.race([runPromise, timeoutPromise])
    if (timer) clearTimeout(timer)

    if ('reason' in result && result.ok === false && result.reason === 'timeout') {
      return { ok: false, reason: 'timeout' }
    }

    if (result.ok === false) {
      if (
        result.reason === 'disabled' ||
        result.reason === 'forbidden' ||
        result.reason === 'no-providers' ||
        result.reason === 'over-quota'
      ) {
        return { ok: false, reason: 'disabled' }
      }
      return { ok: false, reason: 'failed' }
    }

    const data = result.data as IntentClassification
    return { ok: true, intent: data.intent, confidence: data.confidence }
  } catch {
    if (timer) clearTimeout(timer)
    return { ok: false, reason: 'failed' }
  }
}
