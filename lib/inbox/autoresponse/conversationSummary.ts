/**
 * Memory that survives past the recent-message window.
 *
 * THE GAP THIS FILLS. The worker reads a bounded window of recent messages.
 * Structured facts (name, need, urgency…) survive beyond it, but they are a
 * fixed set of fields — a customer who explains a constraint in prose at message
 * 6, or asks something the agent deferred, has that simply vanish once the
 * window rolls past. The agent then asks again, or drops the thread.
 *
 * THE SHAPE. Three layers, cheapest first:
 *   1. structured facts  — exact values, never summarised, already persisted
 *   2. rolling summary   — this file: prose that outlived the window
 *   3. recent messages   — verbatim, the last N turns
 *
 * Cost is roughly flat per turn instead of growing with the conversation: the
 * summary is regenerated only when the window actually rolls, and only over the
 * messages that just fell out of it.
 *
 * WHAT THE SUMMARY IS FOR, in priority order — needs, unanswered questions,
 * corrections, commitments made. Not a transcript, not a précis of pleasantries.
 * A summary that loses "she said Tuesdays don't work" to make room for "the
 * customer greeted us warmly" is worse than no summary.
 */
import { z } from 'zod'
import { runStructured } from '@/lib/ai/router'

/** Verbatim turns kept in the prompt. Older messages live only in the summary. */
export const RECENT_WINDOW = 24
/**
 * Re-summarise only once this many messages sit outside the window, so an active
 * conversation does not pay for a summarisation model call every single turn.
 */
export const SUMMARY_BATCH = 8

export type SummaryState = {
  summary: string | null
  /** Highest message sequence the summary accounts for. 0 = nothing summarised. */
  summaryThroughSequence: number
}

export type Turn = { direction: 'inbound' | 'outbound'; text: string; sequence: number }

export type SummaryPlan =
  | { action: 'keep' }
  | { action: 'summarise'; upToSequence: number; olderTurns: Turn[]; recentTurns: Turn[] }

/**
 * Decide whether this turn needs to move the summary forward.
 *
 * Pure. `transcript` is the full window the worker read, oldest first.
 */
export function planSummary(transcript: Turn[], state: SummaryState): SummaryPlan {
  if (transcript.length <= RECENT_WINDOW) return { action: 'keep' }

  const cutIndex = transcript.length - RECENT_WINDOW
  const older = transcript.slice(0, cutIndex)
  const recent = transcript.slice(cutIndex)
  const upToSequence = older[older.length - 1]?.sequence ?? 0
  if (!upToSequence) return { action: 'keep' }

  // Already covered, or not enough new material to be worth a model call.
  const pending = older.filter((t) => t.sequence > state.summaryThroughSequence)
  if (pending.length < SUMMARY_BATCH && state.summaryThroughSequence > 0) return { action: 'keep' }
  if (!pending.length) return { action: 'keep' }

  return { action: 'summarise', upToSequence, olderTurns: older, recentTurns: recent }
}

/** The verbatim slice that goes into the prompt this turn. */
export function recentWindow(transcript: Turn[]): Turn[] {
  return transcript.length <= RECENT_WINDOW ? transcript : transcript.slice(transcript.length - RECENT_WINDOW)
}

const SummarySchema = z.object({
  summary: z
    .string()
    .describe('סיכום קצר ועובדתי של מה שנאמר בשיחה עד כה, בעברית, עד 8 שורות'),
})

const SYSTEM = [
  'את/ה מסכם/ת שיחת וואטסאפ בין עסק ללקוח, לצורך זיכרון פנימי של הסוכן.',
  'הסיכום הזה לא נשלח ללקוח. הוא נועד כדי שהסוכן לא ישאל שוב על מה שכבר נאמר.',
  'שמור/שמרי, לפי סדר חשיבות:',
  '1. מה הלקוח צריך, ומה הוא סיפר על המצב שלו.',
  '2. שאלות שהלקוח שאל ועדיין לא קיבלו תשובה.',
  '3. תיקונים: פרט שהלקוח שינה. רשום/רשמי רק את הערך המעודכן, וציין/י שזה תיקון.',
  '4. מה הובטח או נאמר שיקרה, ומי אמור לעשות את זה.',
  '5. העדפות ואילוצים שהלקוח ציין.',
  'אל תסכם/י ברכות, תודות, או נימוסים.',
  'אל תוסיף/י שום דבר שלא נאמר בשיחה. אל תפרש/י ואל תסיק/י.',
  'אם צורף סיכום קודם, שלב/י אותו: מידע שעדיין רלוונטי נשמר, מידע שתוקן מוחלף.',
  'כתוב/כתבי בעברית, בקצרה, בשורות נפרדות.',
].join('\n')

export type SummariseResult =
  | { ok: true; summary: string; throughSequence: number }
  | { ok: false; reason: string }

export async function summariseConversation(args: {
  agencyId: number
  previousSummary: string | null
  olderTurns: Turn[]
  upToSequence: number
}): Promise<SummariseResult> {
  const body = args.olderTurns
    .map((t) => `${t.direction === 'inbound' ? 'לקוח' : 'אנחנו'}: ${t.text}`)
    .join('\n')
  if (!body.trim()) return { ok: false, reason: 'nothing_to_summarise' }

  const user = [
    args.previousSummary ? `סיכום קודם:\n${args.previousSummary}` : 'סיכום קודם: (אין)',
    '',
    'ההודעות לסיכום:',
    body,
  ].join('\n')

  const out = await runStructured({
    kind: 'inbox.autoResponse',
    schema: SummarySchema,
    schemaName: 'ConversationSummary',
    system: SYSTEM,
    user,
    agencyId: args.agencyId,
  })

  if (out.ok === false) return { ok: false, reason: out.reason ?? 'ai_unavailable' }
  const summary = String((out.data as { summary: string }).summary ?? '').trim()
  if (!summary) return { ok: false, reason: 'empty_summary' }
  return { ok: true, summary: summary.slice(0, 2000), throughSequence: args.upToSequence }
}

/** Prompt block. Absent when there is nothing older than the window. */
export function formatSummaryBlock(summary: string | null): string | null {
  const s = (summary ?? '').trim()
  if (!s) return null
  return [
    'מה שכבר נאמר קודם בשיחה הזו (זיכרון פנימי, לא לשלוח ללקוח, לא לצטט כלשונו):',
    s,
    'אל תשאל/י שוב על מה שמופיע כאן.',
  ].join('\n')
}
