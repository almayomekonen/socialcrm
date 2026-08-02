import crypto from 'crypto'

/**
 * Lead-scoped unsubscribe token (ADR-003): stateless HMAC over
 * (agencyId, leadId) — NEVER the platform's userId token, never its secret.
 * Tokens ship inside emails and live in inboxes forever: the payload shape is
 * frozen at first live send, and secret rotation must keep verifying against
 * prior secrets (a verify-window concern for the Phase 5 route).
 */

function secret(): string {
  // Engine-owned secret only (AUTOMATIONS_* prefix discipline, spec §0).
  // Deliberately no fallback to platform secrets (UNSUBSCRIBE_SECRET,
  // CRON_SECRET) — the two domains' tokens must never be interchangeable.
  return process.env.AUTOMATIONS_UNSUBSCRIBE_SECRET?.trim() || 'dev-automations-unsubscribe-secret'
}

export function signLeadUnsubscribe(agencyId: number, leadId: number): string {
  return crypto.createHmac('sha256', secret()).update(`unsub:agency:${agencyId}:lead:${leadId}`).digest('hex')
}

export function verifyLeadUnsubscribe(agencyId: number, leadId: number, token: string): boolean {
  if (!token) return false
  const expected = Buffer.from(signLeadUnsubscribe(agencyId, leadId))
  const provided = Buffer.from(token)
  if (expected.length !== provided.length) return false
  return crypto.timingSafeEqual(expected, provided)
}
