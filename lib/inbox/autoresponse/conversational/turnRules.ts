/**
 * Which turn rules a SOCIAL conversation (personal or mixed) changes. Pure.
 *
 * The sales rules silence a lot of what friends write: "חחחח" or "מה איתך"
 * after our reply is a casual acknowledgement (close, no reply), and a
 * low-information message is WAIT. In a conversation the last turn read as
 * personal, those messages are the conversation itself, so they reach the model.
 *
 * Only these rules move, and only when the remembered mode still holds
 * (mode.ts socialHintHolds). Opt-out, human takeover, typing, the personal
 * mark, the 24-hour window, quiet hours, the daily cap, the kill switch and the
 * send-time checks run before and after this exactly as always.
 */

import { detectHumanRequest, isExplicitPersonRequest } from '../salesIntent'
import type { ConversationMode } from './mode'

/**
 * MEETING WORDS ARE NOT A REQUEST FOR A PERSON. The sales rules read any meeting
 * mention ("פגישה", "להיפגש", "זום") as a handoff and answer before the model
 * runs: "מתגעגע אחי, חייבים להיפגש" got "your request is waiting for the team",
 * and so did "is our appointment still on?". On the conversational agent:
 *   - an explicit request for a person still hands off before the model, as always;
 *   - a meeting-only mention goes to the model, which reads the conversation;
 *   - after generation, a NEW booking need (prospect, scheduling, service
 *     request, pricing) is handed to the team exactly as before, while a friend,
 *     an existing customer asking about their appointment, support and follow-ups
 *     get the reply. That reply still cannot book or commit (the validators).
 */
export function meetingOnlyHandoff(text: string, previousOutbound?: string): boolean {
  return detectHumanRequest(text, { previousOutbound }) && !isExplicitPersonRequest(text)
}

/**
 * A request TO THE BUSINESS to book, move, cancel or check a slot. Deterministic,
 * and it wins over the model: "אחי אפשר לקבוע למחר?" is business even when it is
 * said like a friend. It needs a verb AND a slot or business object, so a friend's
 * "חייבים לקבוע" or "חייבים להיפגש" stays personal.
 */
const SLOT = '(?:פגישה|הפגישה|פגישת|תור|התור|תאריך|מועד|המועד|שעה|ל?מחר|ל?מחרתיים|ל?היום|ל?שבוע\\s+הבא|ב?יום\\s+(?:ראשון|שני|שלישי|רביעי|חמישי|שישי)|ב?(?:ראשון|שני|שלישי|רביעי|חמישי|שישי)|בשבת|[בל][-־]?\\d{1,2}(?:[./:]\\d{1,2})?|אירוע|האירוע|איתכם|אצלכם)'
const B = '(?<![\\p{L}])'
const E = '(?![\\p{L}])'
const SCHEDULING = [
  new RegExp(`${B}(?:לקבוע|לתאם|לשריין|לסגור|תקבע(?:ו|י)?|תתאם(?:ו|י)?|תשריין(?:ו|י)?)${E}(?:\\s+\\S+){0,3}?\\s+${SLOT}${E}`, 'u'),
  // "נקבע/נתאם" is how friends make plans too: only with a business object, never with just a day.
  new RegExp(`${B}(?:נקבע|נתאם|נסגור)${E}(?:\\s+\\S+){0,3}?\\s+(?:פגישה|תור|תאריך|מועד|איתכם|אצלכם)${E}`, 'u'),
  new RegExp(`${B}(?:ת?זיז(?:ו|י)?|להזיז|לדחות|תדחה|תדחו|לבטל|תבטל(?:ו|י)?|לשנות|תשנה)${E}(?:\\s+\\S+){0,3}?\\s+(?:את\\s+)?(?:ה)?(?:פגישה|תור|אירוע|מועד|תאריך)${E}`, 'u'),
  new RegExp(`${B}(?:יש\\s+לכם|יש\\s+אצלכם|אתם)\\s+(?:עדיין\\s+)?(?:מקום|זמן|תאריך|פנוי(?:ים|ה)?|זמינ(?:ים|ות)?)${E}`, 'u'),
  new RegExp(`${B}(?:מתי\\s+אתם\\s+פנויים|מתי\\s+יש\\s+(?:לכם\\s+)?(?:מקום|תור|זמן))${E}`, 'u'),
]
export function isSchedulingRequest(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim()
  return !!t && SCHEDULING.some((re) => re.test(t))
}

const NEW_BOOKING_MODES: ReadonlySet<ConversationMode> = new Set(['prospect', 'scheduling', 'service_request', 'pricing'])
export const meetingNeedsTeam = (mode: ConversationMode): boolean => NEW_BOOKING_MODES.has(mode)

/** A pure acknowledgement a person would not answer: a thumbs up, "סבבה", "תודה". */
const BARE_ACK =
  /^(?:👍|👌|🙏|✅|❤️|♥️|אוקי|אוקיי|אוקיי?\s*סבבה|סבבה|יופי|טוב|בסדר|קיבלתי|תודה|תודה\s+רבה|מעולה|אחלה|ok|okay|k|thx|thanks)[\s!.,]*$/iu
const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️\s]+$/u
const LAUGHTER = /(?:חח+|ההה+|😂|🤣|lol|haha)/iu

/** Would a person in a personal conversation answer this? */
export function personalReplyWarranted(text: string): boolean {
  const t = (text ?? '').trim()
  if (!t) return false
  if (LAUGHTER.test(t)) return true
  if (BARE_ACK.test(t)) return false
  if (EMOJI_ONLY.test(t)) return false
  return true
}

export type SocialTurn = 'default' | 'generate' | 'skip_quietly'

/**
 * Applied where the sales rules would close silently, close with the canned
 * closer, or WAIT. Only in a conversation whose remembered mode is social.
 *   generate      the message deserves a reply: let the model answer it;
 *   skip_quietly  a bare acknowledgement: no reply, and the conversation is NOT
 *                 closed (a friend's next message must not need a "reopen");
 *   default       not a social conversation: the sales rules decide, unchanged.
 */
export function socialTurn(input: { socialHint: boolean; inboundText: string; salesRuleSilences: boolean }): SocialTurn {
  if (!input.socialHint || !input.salesRuleSilences) return 'default'
  return personalReplyWarranted(input.inboundText) ? 'generate' : 'skip_quietly'
}

/** A closed conversation reopens for a friend who keeps talking, not for a thumbs up. */
export function socialReopen(input: { socialHint: boolean; inboundText: string }): boolean {
  return input.socialHint && personalReplyWarranted(input.inboundText)
}
