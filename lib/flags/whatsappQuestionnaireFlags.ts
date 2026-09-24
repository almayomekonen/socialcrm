/**
 * Deterministic questionnaire rollout gate.
 *
 * ABSENCE BLOCKS, in two deliberate steps, matching `whatsappContactsFlags` and
 * `smartReplyAgentFlags`: the master switch AND a named agency. An empty
 * allowlist means NO agency. Shipping this file changes nothing anywhere.
 *
 * WHAT IT GATES. Whether the questionnaire may SPEAK. It does not decide which
 * worker owns a job: that is `questionnaireRouted` in db/questionnaireJobs.ts,
 * which is driven by the stored configuration. The separation is the point. If
 * the flag is pulled from a business that is configured for the questionnaire,
 * its jobs still go to the questionnaire worker, which then stays silent and
 * hands the conversation to a person. Pulling the flag must never be a way for
 * a conversation to end up with the AI agent instead.
 *
 * Read per call, never cached at module scope, so an env change takes effect on
 * the next deployment without any other coordination.
 */

export function isWhatsappQuestionnaireEnabled(): boolean {
  return process.env.WA_QUESTIONNAIRE_ENABLED === '1'
}

function parseAllowlist(raw: string | undefined): 'all' | Set<number> {
  const v = raw?.trim() ?? ''
  if (v === 'all') return 'all'
  const ids = v
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
  return new Set(ids)
}

export function isWhatsappQuestionnaireAgencyAllowlisted(agencyId: number): boolean {
  const list = parseAllowlist(process.env.WA_QUESTIONNAIRE_AGENCY_IDS)
  return list === 'all' ? true : list.has(agencyId)
}

export function canUseWhatsappQuestionnaire(agencyId: number | null | undefined): boolean {
  if (!agencyId) return false
  if (!isWhatsappQuestionnaireEnabled()) return false
  return isWhatsappQuestionnaireAgencyAllowlisted(agencyId)
}
