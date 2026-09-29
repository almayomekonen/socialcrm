/**
 * A questionnaire question held back by a typing hold that began BEFORE the turn.
 *
 * THE BUG THIS CLOSES. The send guard refuses `human_typing` while a rep's
 * typing TTL is live. For the AI agent that refusal discards a reply that may
 * be stale anyway, and the next customer message starts a fresh turn. For the
 * questionnaire it was a dead end: the customer has answered and is waiting,
 * the follow-up rule sees no newer inbound (`already_covered`), and nothing ever
 * asked the next question. Production, 2026-09-29: a hold that lapsed 56 ms
 * after the refusal cost the customer the rest of the questionnaire.
 *
 * WHAT THIS DOES INSTEAD. The job goes back to `pending` with `notBefore` just
 * after the hold expires, through the same defer the quiet-hours rule uses. Nothing
 * of the turn was persisted — the answer is saved only after the question is
 * out — so the deferred run re-reads the same transcript, reaches the same
 * decision and the same turn key, and every guard runs again from scratch.
 *
 * WHY THIS IS NOT A WAY AROUND THE GUARD.
 *   · Only `human_typing` is deferred. `authorizeAgentSend` returns it only when
 *     the last keystroke is OLDER than the turn: a keystroke inside the turn is
 *     `human_typing_this_turn` and still discards, and `human_active` still ends
 *     the session. Neither reason reaches this file.
 *   · The deferred run is authorized by the same guard, with a fresh read.
 *   · It terminates. The hold's expiry is set by keystrokes, and any keystroke
 *     after the turn began turns the next refusal into `human_typing_this_turn`.
 *     So once `notBefore` passes the expiry read here, this turn cannot be
 *     deferred again — at most one defer per pre-turn hold.
 *
 * CLOCK. `humanTypingUntil` and `now` both come from Postgres, and the claim
 * compares `notBefore` with Postgres `now()`, so no process clock is involved.
 */
import { deferAutoResponseJob, type AutoResponseJob } from '@/db/autoResponseJobs'
import { readHumanPresence } from '@/db/conversationHumanPresence'
import { HUMAN_TYPING_TTL_MS, type HumanPresenceFacts } from '../humanPresence'

/** How long after the hold expires the deferred turn becomes claimable. */
export const TYPING_DEFER_MARGIN_MS = 1_000

/** `lastError` on a job deferred for a typing hold, for the job table's readers. */
export const TYPING_DEFER_NOTE = 'human_typing_deferred'

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : null
}

/** Just after the hold expires; just after now if it already has. */
export function typingDeferUntil(f: Pick<HumanPresenceFacts, 'humanTypingUntil' | 'now'>): Date {
  const now = ms(f.now) ?? Date.now()
  const until = ms(f.humanTypingUntil)
  return new Date(Math.max(until ?? now, now) + TYPING_DEFER_MARGIN_MS)
}

/**
 * Put the job back for after the hold. The caller has already released its
 * send claim. If presence cannot be read, wait out one full TTL instead: the
 * deferred run's guard still decides, so an unreadable row costs time, never safety.
 */
export async function deferForTypingHold(job: AutoResponseJob): Promise<Date> {
  let notBefore: Date
  try {
    notBefore = typingDeferUntil(await readHumanPresence(job.conversationId))
  } catch {
    notBefore = new Date(Date.now() + HUMAN_TYPING_TTL_MS + TYPING_DEFER_MARGIN_MS)
  }
  await deferAutoResponseJob(job.id, notBefore, TYPING_DEFER_NOTE)
  return notBefore
}
