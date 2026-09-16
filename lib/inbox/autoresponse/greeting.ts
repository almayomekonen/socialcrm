/**
 * First-greeting policy for the WhatsApp agent. Pure — no I/O.
 *
 * The model never decides whether to greet. It is told, per turn, either "open
 * with exactly this line" or nothing at all. Letting the model judge "is this
 * the start of the conversation?" from a transcript is how a greeting ends up
 * on turn five, and how it goes missing on turn one.
 *
 * IDEMPOTENCY. The decision is a function of durable state — how many customer
 * facing messages the business has already sent on this conversation — not of
 * anything carried inside a job. That is what makes it safe under the two ways
 * a turn can repeat:
 *
 *   · A job retry. A retry only happens when the previous attempt did not
 *     deliver, so no outbound row exists, and greeting again is correct.
 *   · A duplicate webhook. Meta redelivery is dropped upstream on
 *     (channel, externalId) and never reaches a second job.
 *
 * Concurrency is settled a layer down: `auto_response_jobs_inflight_uniq`
 * allows one pending/processing job per conversation, so two turns can never
 * evaluate this at the same moment.
 *
 * There is deliberately NO time-based reset here. A dormancy window that
 * re-greets a returning customer would have to agree with `aiState`
 * (escalated / human_active / opted_out / closed) and with the handoff
 * lifecycle, and getting that wrong greets someone a human is already talking
 * to. Greeting stays a once-per-conversation event until that interaction is
 * designed.
 */

export type GreetingLang = 'he' | 'en'

export interface GreetingFacts {
  /** True when the business has already sent something here — agent or human. */
  hasPriorOutbound: boolean
  /**
   * Agent turns already recorded on this conversation. A second, independent
   * signal for the same question: if the message table and the turn counter ever
   * disagree, either one saying "we have spoken" is enough to stay quiet. A
   * missed greeting costs nothing; a welcome in the middle of a live
   * conversation is the failure worth engineering against.
   */
  aiTurnCount?: number
  /** Business name from agency settings. Null/empty ⇒ neutral welcome, never invented. */
  businessName: string | null
  /** Language of the customer's message this turn. */
  lang: GreetingLang
  /**
   * Conversation lifecycle. A conversation that already reached a human, opted
   * out, or was handed off is not a first contact, whatever the message count.
   */
  aiState?: string | null
}

export type GreetingDecision =
  | { greet: true; line: string }
  | { greet: false; reason: 'already_spoke' | 'not_first_contact_state' }

const NON_GREETING_STATES = new Set(['escalated', 'human_active', 'opted_out', 'closed'])

/** Exactly the wording product asked for, per language. One emoji, at the end. */
export function greetingLine(businessName: string | null, lang: GreetingLang): string {
  const name = (businessName ?? '').trim()
  if (!name) {
    // No name configured. A neutral welcome — never a guessed or generic
    // stand-in like "our business", which reads as a broken template.
    return lang === 'en' ? 'Hi, welcome 👋' : 'היי, ברוך הבא 👋'
  }
  return lang === 'en' ? `Hi, welcome to ${name} 👋` : `היי, ברוך הבא ל${name} 👋`
}

export function decideGreeting(facts: GreetingFacts): GreetingDecision {
  if (facts.aiState && NON_GREETING_STATES.has(facts.aiState)) {
    return { greet: false, reason: 'not_first_contact_state' }
  }
  if (facts.hasPriorOutbound !== false) {
    // Defaults to NOT greeting. An unknown or unreadable history must never
    // produce a welcome in the middle of a live conversation.
    return { greet: false, reason: 'already_spoke' }
  }
  if (Number(facts.aiTurnCount ?? 0) > 0) return { greet: false, reason: 'already_spoke' }
  return { greet: true, line: greetingLine(facts.businessName, facts.lang) }
}

/**
 * Prefix a reply the model produced with the greeting, for paths that do not
 * route the greeting through the prompt (fixed replies, deterministic
 * fallbacks). Idempotent: text that already opens with the line is left alone.
 */
export function withGreeting(line: string | null, reply: string): string {
  const body = (reply ?? '').trim()
  if (!line) return body
  if (!body) return line
  if (body.startsWith(line)) return body
  return `${line} ${body}`
}
