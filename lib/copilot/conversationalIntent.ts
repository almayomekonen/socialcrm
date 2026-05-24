import type { SocialIntent } from './intents'

// Deterministic reply pools, one per social intent. Detection of intent
// happens upstream in `quickClassifyIntent` / `classifyIntentWithLLM`.
// This module's only job is mapping a confirmed social intent to a reply.

const REPLIES: Record<SocialIntent, readonly string[]> = {
  'social.gratitude': ['בשמחה 😊', 'בכיף', 'בשמחה, אני כאן אם צריך'],
  'social.greeting': ['שלום! 👋', 'היי', 'שלום, איך אפשר לעזור?'],
  'social.positive': ['מעולה 😄', 'יפה!', 'שמחתי לעזור'],
  'social.farewell': ['נתראה 👋', 'יום טוב!', 'להתראות'],
}

/**
 * Deterministic per-input reply selection. Identical inputs always get the
 * same reply (no surprise variation); different inputs rotate through the
 * pool via input-string hash. Avoids the chatbot feel of random responses
 * while preventing literal echo when the same user message repeats.
 */
export function pickConversationalReply(intent: SocialIntent, seed: string): string {
  const pool = REPLIES[intent]
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  const idx = Math.abs(hash) % pool.length
  return pool[idx]
}
