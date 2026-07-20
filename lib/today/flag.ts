// Today brief v2 — server-side feature flag (global kill switch). Evaluated only
// on the server (RSC). Per-agency targeting can layer on top later (Phase 5);
// this is the merge-dark gate so the new brief ships without user impact until
// enabled. Not pure (reads env) → lives outside the domain purity guard.

export function todayBriefV2Enabled(): boolean {
  return process.env.TODAY_BRIEF_V2 === '1'
}
