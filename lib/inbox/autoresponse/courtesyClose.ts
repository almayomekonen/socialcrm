/**
 * WhatsApp Agent — answering "thank you".
 *
 * A customer who thanks the business at the end of a conversation gets one short,
 * warm reply and nothing else. Before this, they got silence: the closing
 * acknowledgement rule in Conversation Control treats "תודה רבה" as a close and
 * sends nothing, which is right about the INTENT and wrong about the MANNERS.
 * Ending a conversation the customer thanked you for by saying nothing is the
 * one moment where silence reads as rudeness rather than restraint.
 *
 * ONE LINE, ONCE, THEN DONE. The reply carries no question, no pitch and no
 * offer, so there is nothing to answer and the exchange cannot continue. A
 * second "תודה" gets silence, because two courtesies in a row is a loop, and the
 * guard is durable — it reads the transcript for a courtesy we already sent
 * rather than trusting in-memory state across job retries.
 *
 * WHAT IT DOES NOT DO. It does not reopen qualification, does not change
 * ownership, does not call a model, and does not alter `aiState` beyond the
 * close that was happening anyway. It is a closing pleasantry, not a turn.
 *
 * GRATITUDE IS NARROWER THAN ACKNOWLEDGEMENT. "אוקיי", "סבבה" and "הבנתי" are
 * acknowledgements and still close in silence — replying "בשמחה" to "אוקיי"
 * would be answering something nobody said. Only actual thanks qualifies.
 */

/** The metadata kind stamped on a courtesy reply, and the once-only key. */
export const COURTESY_KIND = 'courtesy_close'

const GRATITUDE_RE =
  /^(?:\s*(?:רב[הו]?\s+)?תודה(?:\s+רב[הו]?)?(?:\s+ל[ךכם])?|\s*מעריך|\s*מעריכה|\s*מודה ל[ךכם]|\s*thank(?:s| you)(?: (?:so|very) much| a lot)?|\s*much appreciated|\s*appreciate it|\s*ty)\s*[!.…🙏🙂😊❤️]*\s*$/iu

/**
 * Is this message thanks, and only thanks?
 *
 * Anchored to the whole utterance on purpose. "תודה, אבל כמה זה עולה?" is a
 * question wearing a polite opening and must reach the normal path — a courtesy
 * line would drop a real question on the floor.
 */
export function isGratitude(text: string): boolean {
  const t = (text ?? '').trim()
  if (!t) return false
  return GRATITUDE_RE.test(t)
}

/** The whole vocabulary. Short, warm, and impossible to reply to. */
const COURTESY = {
  he: ['בשמחה 🙂', 'שמחתי לעזור 🙂', 'בכיף 🙂'],
  en: ['Happy to help 🙂', 'Anytime 🙂', 'Glad I could help 🙂'],
} as const

/**
 * Deterministic pick, so the same conversation never produces a different line
 * on a job retry. Not random: a retry that changed the wording would read as two
 * different replies to the customer if the first one did in fact land.
 */
export function courtesyLine(lang: 'he' | 'en', conversationId = 0): string {
  const options = COURTESY[lang]
  return options[Math.abs(conversationId) % options.length]
}

export type CourtesyFacts = {
  /** The customer's latest message. */
  inboundText: string
  /** The agent has spoken here — there is something to be thanked for. */
  agentHasSpoken: boolean
  /** A person replied in their own words, or explicitly took over. */
  humanTookOver: boolean
  /** The customer asked us to stop. Outranks politeness. */
  optOut: boolean
  /** A courtesy line already went out in this conversation. */
  alreadySentCourtesy: boolean
}

export type CourtesyDecision =
  | { send: true }
  | { send: false; reason: 'not_gratitude' | 'agent_never_spoke' | 'human_owns' | 'opted_out' | 'already_sent' }

/**
 * Should this closing message get a courtesy reply?
 *
 * Deliberately says nothing about WHY the conversation is ending — handoff,
 * close, or an answered question. Thanks is thanks. The caller has already
 * decided the conversation is closing; this only decides whether it closes
 * politely or silently.
 */
export function decideCourtesyClose(f: CourtesyFacts): CourtesyDecision {
  if (f.optOut) return { send: false, reason: 'opted_out' }
  // A human in the conversation does their own thanking. The agent appending
  // "בשמחה" under a rep's reply is a second voice on the line.
  if (f.humanTookOver) return { send: false, reason: 'human_owns' }
  if (!f.agentHasSpoken) return { send: false, reason: 'agent_never_spoke' }
  if (!isGratitude(f.inboundText)) return { send: false, reason: 'not_gratitude' }
  if (f.alreadySentCourtesy) return { send: false, reason: 'already_sent' }
  return { send: true }
}

/** True when this outbound row is a courtesy reply we already sent. */
export function isCourtesyMessage(metadata: unknown): boolean {
  try {
    const m = typeof metadata === 'string' ? JSON.parse(metadata) : metadata
    return (m as { kind?: string } | null)?.kind === COURTESY_KIND
  } catch {
    return false
  }
}
