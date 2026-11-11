import { EMPTY_AGENT_PROFILE, isEmptyAgentProfile, normalizeAgentProfile, type AgentProfile, type AgentTone, type FaqItem } from '../conversational/agentProfile'

/**
 * The test chat's unsaved agent-profile fields (greeting, tone, FAQ) laid over
 * the SAVED profile, so "בדקו את הסוכן שלכם" answers with what the owner is
 * typing rather than what they last saved.
 *
 * OPTIONAL, FIELD BY FIELD. A field that is absent (`undefined`) keeps the saved
 * value, so a caller that sends none of them — every caller before these fields
 * existed — gets exactly the saved profile. A field that IS sent replaces the
 * saved one, including with "nothing": '' greeting, '' tone (adapt to the
 * customer) or [] FAQ.
 *
 * Owner text from the browser: the merged profile goes through the same
 * `normalizeAgentProfile` (types, control characters, length and count caps)
 * the save uses, so the preview can never see text the save would refuse.
 */
export type DraftAgentProfileFields = {
  greeting?: string | null
  tone?: AgentTone | '' | null
  faq?: FaqItem[] | null
}

export function withDraftAgentProfile(
  saved: AgentProfile | null | undefined,
  draft: DraftAgentProfileFields | undefined,
): { profile: AgentProfile | null; changed: boolean } {
  const base = saved ?? EMPTY_AGENT_PROFILE
  if (!draft || (draft.greeting === undefined && draft.tone === undefined && draft.faq === undefined)) {
    return { profile: saved ?? null, changed: false }
  }
  const merged = normalizeAgentProfile({
    ...base,
    ...(draft.greeting !== undefined ? { greeting: draft.greeting || null } : {}),
    ...(draft.tone !== undefined ? { tone: draft.tone || null } : {}),
    ...(draft.faq !== undefined ? { faq: Array.isArray(draft.faq) ? draft.faq : [] } : {}),
  })
  const before = normalizeAgentProfile(base)
  const changed = merged.greeting !== before.greeting || merged.tone !== before.tone || JSON.stringify(merged.faq) !== JSON.stringify(before.faq)
  return { profile: isEmptyAgentProfile(merged) ? null : merged, changed }
}
