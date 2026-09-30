/**
 * WhatsApp agent reliability rollout gate (ownership + silence correctness).
 *
 * ABSENCE BLOCKS: an unset or empty allowlist means NO agency, so shipping this
 * file changes nothing anywhere. `all` enables every agency. Read per call,
 * never cached at module scope, so an env change takes effect on the next
 * deployment without any other coordination.
 *
 * WHAT IT GATES, per agency:
 *   · human takeover is decided by the canonical `isHumanOutbound` rule and only
 *     counts messages after the last "return to agent" (ownership epoch),
 *     for the AI agent and the questionnaire alike;
 *   · a reopened closed conversation resumes as `ai_qualifying`;
 *   · a greeting-only first message and a media-only message get a
 *     deterministic reply instead of silence (no model call);
 *   · an image/document caption is read as the customer's text;
 *   · an agency without the AI entitlement gets no doomed AI job, and the inbox
 *     says the automatic reply is paused.
 */

function parseAllowlist(raw: string | undefined): 'all' | Set<number> {
  const v = raw?.trim() ?? ''
  if (v === 'all') return 'all'
  const ids = v
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
  return new Set(ids)
}

export function canUseAgentReliability(agencyId: number | null | undefined): boolean {
  if (!agencyId || !(Number(agencyId) > 0)) return false
  const list = parseAllowlist(process.env.AGENT_RELIABILITY_AGENCY_IDS)
  return list === 'all' ? true : list.has(Number(agencyId))
}
