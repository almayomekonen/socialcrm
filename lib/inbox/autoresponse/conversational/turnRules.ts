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
