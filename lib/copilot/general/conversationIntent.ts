/**
 * Conversation Intent — deterministic discourse-act detector.
 *
 * Exact/normalized matches only, so a real business question that merely
 * contains a word is never hijacked. Usable previous state is required by
 * the caller before these acts are answered as follow-ups.
 */
export type ConversationIntent = 'follow_up' | 'why' | 'who_else' | 'how' | 'now' | 'none'

function normalizeDiscourse(text: string): string {
  let t = text.trim().toLowerCase().replace(/[?!.־\s]+$/u, '').replace(/\s+/gu, ' ')
  if (t.startsWith('ו') && t.length > 1) t = t.slice(1).trim()
  return t
}

const FOLLOW_UP = new Set([
  'anything else',
  'what else',
  'continue',
  'go on',
  'keep going',
  'more',
  'עוד משהו',
  'מה עוד',
  'תמשיך',
  'המשך',
  'עוד',
  'תן לי עוד',
  'תני לי עוד',
])

const WHY = new Set(['למה', 'מדוע', 'why', 'why is that'])

const WHO_ELSE = new Set(['מי עוד', 'who else', 'and who else'])

const HOW = new Set(['איך', 'איך ממשיכים', 'how'])

const NOW = new Set(['מה עכשיו', 'אז מה', "what's next now"])

export function classifyConversationIntent(text: string): ConversationIntent {
  const t = normalizeDiscourse(text)
  if (FOLLOW_UP.has(t)) return 'follow_up'
  if (WHY.has(t)) return 'why'
  if (WHO_ELSE.has(t)) return 'who_else'
  if (HOW.has(t)) return 'how'
  if (NOW.has(t)) return 'now'
  return 'none'
}
