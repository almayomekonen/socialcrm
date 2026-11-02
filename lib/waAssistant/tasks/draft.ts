import { businessDateString, businessInstantMs } from '@/lib/today/time'
import { parseHebrewWhen, readTimes } from '../meetings/when'

/**
 * ONE task or follow-up request, spread over the owner's messages ("תיצור לי
 * משימה" → "Oren kakun" → "לשעה 12:00 להתקשר לאורן" → "מחר"), read back from
 * their own words. Pure.
 *
 * Messages come newest first, and for each detail the newest message that
 * mentions it decides: a later "ביום שני" replaces an earlier "מחר", and a time
 * given while we were still asking for the day is kept. A detail a message
 * cannot be read with certainty is a problem to ask about, never a guess.
 *
 * A day the owner did not name is left null; the caller makes it today (in the
 * business timezone). Tasks and follow-ups store a DAY (date-only columns, the product's own date
 * control), so a time of day is kept in the wording — "להתקשר לאורן בשעה
 * 12:00" — and shown on the card, never written into the date.
 */

export type TaskKind = 'task' | 'follow_up'
export type DraftProblem = 'ambiguous_date' | 'past_date' | 'ambiguous_time'
export type TaskDraft = {
  /** The day the owner named; null when they named none (the caller defaults to today). */
  date: string | null
  /** The clock time ("12:00") the owner gave, or null. */
  time: string | null
  /** "בשעה 12:00", or a part of the day ("בבוקר") when no clock time was given. */
  when: string | null
  /** The task / follow-up the owner named, or null when they did not (or named both). */
  kind: TaskKind | null
  problem: DraftProblem | null
  /** The hour of an ambiguous "ב-4", to ask about it. */
  hour: number | null
}

const PARTS_OF_DAY: [RegExp, string][] = [
  [/בבוקר/u, 'בבוקר'],
  [/בצהריים/u, 'בצהריים'],
  [/אחה["״']?צ|אחר(?:י)? הצהריים/u, 'אחר הצהריים'],
  [/בערב/u, 'בערב'],
  [/בלילה/u, 'בלילה'],
]
const LATER_PARTS = new Set(['בצהריים', 'אחר הצהריים', 'בערב', 'בלילה'])
const pad = (n: number) => String(n).padStart(2, '0')
const RE_TASK_OF_FOLLOW_UP = /משימ\S*\s+(?:של\s+)?מעקב/u
const RE_TASK = /משימ/u
const RE_FOLLOW_UP = /מעקב|פולואפ|follow[\s-]?up/iu

function kindOf(text: string): TaskKind | 'both' | null {
  if (RE_TASK_OF_FOLLOW_UP.test(text)) return 'task'
  const task = RE_TASK.test(text)
  const followUp = RE_FOLLOW_UP.test(text)
  return task && followUp ? 'both' : task ? 'task' : followUp ? 'follow_up' : null
}

export function readDraft(newestFirst: readonly string[], nowMs: number): TaskDraft {
  const d: TaskDraft = { date: null, time: null, when: null, kind: null, problem: null, hour: null }
  let dateDone = false
  let timeDone = false
  let kindDone = false
  let part: string | null = null
  for (const text of newestFirst) {
    if (!dateDone) {
      const p = parseHebrewWhen(text, nowMs)
      if (p.problem === 'ambiguous_date' || p.problem === 'past_date') {
        d.problem = p.problem
        dateDone = true
      } else if (p.date) {
        d.date = p.date
        dateDone = true
      }
    }
    if (!timeDone) {
      const t = readTimes(text)
      if (t.times.length > 1 || t.problem) {
        const hour = t.times.length === 1 ? Number(t.times[0].slice(0, 2)) : null
        // "ב-4" answered later by "אחר הצהריים" is one time: 16:00.
        if (part && hour !== null) d.time = `${pad(LATER_PARTS.has(part) && hour < 12 ? hour + 12 : hour)}:00`
        else {
          d.problem = d.problem ?? 'ambiguous_time'
          d.hour = hour
        }
        timeDone = true
      } else if (t.times.length === 1) {
        d.time = t.times[0]
        timeDone = true
      } else if (!part) {
        part = PARTS_OF_DAY.find(([re]) => re.test(text))?.[1] ?? null
      }
    }
    if (!kindDone) {
      const k = kindOf(text)
      if (k) {
        d.kind = k === 'both' ? null : k
        kindDone = true
      }
    }
  }
  d.when = d.time ? `בשעה ${d.time}` : timeDone ? null : part
  return d
}

/** The owner's description, with the time of day they gave — unless it already says it. */
export function withWhen(text: string | null | undefined, when: string | null, max: number): string {
  const t = (text ?? '').trim()
  if (!when) return t.slice(0, max)
  const said = t.includes(when) || (when.startsWith('בשעה ') && readTimes(t).times.includes(when.slice(5)))
  const out = said ? t : t ? `${t} ${when}` : when
  return out.slice(0, max)
}

/** The Agent's own one-question reply (no findings, ends in a question mark). */
export function isClarifyingAnswer(a: { headline: string; claims: readonly unknown[]; unknown: string | null }): boolean {
  return a.claims.length === 0 && !a.unknown && /[?？]\s*$/.test(a.headline.trim())
}

export type WhenAsk = 'ambiguous_date' | 'past_date' | 'ambiguous_time' | 'ask_time' | 'past_today'
export type Settled =
  | { ok: true; date: string; time: string | null }
  | { ok: false; ask: WhenAsk; hour: number | null; time: string | null }

/**
 * The day and time to act on. A day the owner did not name is TODAY in the
 * business timezone — never a question. Asked about only: an unclear or past
 * day, an unclear hour, a time the action requires (a meeting) but was not
 * given, and a time today that has already passed (never silently moved).
 */
export function settleWhen(d: TaskDraft, nowMs: number, opts: { timeRequired: boolean }): Settled {
  const no = (ask: WhenAsk): Settled => ({ ok: false, ask, hour: d.hour, time: d.time })
  const today = businessDateString(nowMs)
  if (d.problem === 'ambiguous_date' || d.problem === 'past_date') return no(d.problem)
  if (d.problem === 'ambiguous_time') return no('ambiguous_time')
  if (opts.timeRequired && !d.time) return no('ask_time')
  const date = d.date ?? today
  if (date < today) return no('past_date')
  if (d.time && date === today && businessInstantMs(today, d.time) <= nowMs) return no('past_today')
  return { ok: true, date, time: d.time }
}
