/**
 * Post-handoff responder (Wave 4). A lightweight, flag-gated helper that lets the
 * SAME assistant send a few brief replies AFTER a conversation is handed off
 * (aiState='escalated'): acknowledge, answer only from configured business
 * guidance, or politely defer to a human — until a human replies or the message
 * budget is spent. It restarts no qualification, runs no Runtime, adds no state.
 */

/**
 * Per-agency canary flag, default OFF. Empty/unset allowlist → off everywhere.
 * POST_HANDOFF_KILL=1 is the global backstop.
 */
export function isPostHandoffEnabled(agencyId: number | null | undefined): boolean {
  const kill = process.env.POST_HANDOFF_KILL
  if (kill === '1' || kill === 'true') return false
  const raw = (process.env.POST_HANDOFF_AGENCY_IDS ?? '').trim()
  if (!raw) return false
  if (raw === 'all') return true
  if (!agencyId) return false
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter(Boolean)
    .includes(agencyId)
}

/** Max assistant replies allowed after handoff, per conversation. Default 3 (clamped 1..10). */
export function maxPostHandoffMessages(): number {
  const n = Number(process.env.MAX_POST_HANDOFF_MESSAGES)
  return Number.isFinite(n) && n >= 1 && n <= 10 ? Math.floor(n) : 3
}

const URGENT_PATTERNS: RegExp[] = [
  /דחוף|בהול|מייד|מיידי|עכשיו|תתקשרו אליי|תחזרו אליי מהר/, // Hebrew urgency
  /\burgent|asap|immediately|right now|call me now|emergency\b/i,
]

/** Deterministic urgency flag for a post-handoff inbound (prioritization only, never gates a reply). */
export function detectUrgent(text: string): boolean {
  return URGENT_PATTERNS.some((re) => re.test(text ?? ''))
}
