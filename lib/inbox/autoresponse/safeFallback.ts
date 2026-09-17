/**
 * The reply that goes out when generation could not produce a sendable one.
 *
 * Before this existed, two failed generations ended the turn with
 * `skipReason: 'validation_failed'` and the customer received nothing. Silence
 * is the worst available outcome: the customer assumes the business ignored
 * them, and the owner never learns it happened. A short honest holding message
 * costs nothing and keeps the conversation alive for a human to pick up.
 *
 * Every line here must survive `validateAutoResponse` on its own — no price
 * figure, no commitment, no claimed action, at most one question mark, inside
 * the sentence and character limits. They are asserted against the validator in
 * `__tests__/inbox/autoresponse/safeFallback.test.ts`, so a future change to the
 * guardrail that would make the fallback itself unsendable fails there rather
 * than in production.
 *
 * This text is sent on behalf of whichever business owns the conversation, so it
 * names no trade, claims no capability, and promises no timeframe.
 */
import { withGreeting } from './greeting'

export type FallbackLang = 'he' | 'en'

const ACKNOWLEDGEMENT: Record<FallbackLang, string> = {
  he: 'קיבלתי את ההודעה שלך, תודה. מישהו מהצוות יחזור אלייך בהמשך.',
  en: 'Thanks, I have your message. Someone from the team will get back to you.',
}

const CANNOT_ANSWER: Record<FallbackLang, string> = {
  he: 'אני רוצה לתת לך תשובה מדויקת ולא לנחש. מתי נוח לך שאדם מהצוות יחזור אלייך?',
  en: 'I want to give you an accurate answer rather than guess, so let me pass this to someone from the team. When is a good time to reach you?',
}

export type SafeFallbackKind = 'acknowledgement' | 'cannot_answer'

/**
 * @param greetingLine Passed through on a first contact so the recovery path
 *   still opens with the business welcome — a failed generation must not be the
 *   reason a customer never gets greeted.
 */
export function safeFallbackReply(
  kind: SafeFallbackKind,
  lang: FallbackLang,
  greetingLine?: string | null,
): string {
  const body = kind === 'cannot_answer' ? CANNOT_ANSWER[lang] : ACKNOWLEDGEMENT[lang]
  return withGreeting(greetingLine ?? null, body)
}
