/**
 * May this question reach the open web? Decided by the APPLICATION, before the
 * model sees a tool list. PURE — no I/O, no model call.
 *
 * WHY NOT LET THE MODEL DECIDE. Routing today is prompt-level: the domain names
 * in `domains.ts` guide the model's own framing, and no code has ever branched
 * on them. That is fine when every tool is a scoped, read-only CRM reader and
 * the worst outcome of a wrong choice is a redundant query. It stops being fine
 * once one of the tools costs real money, adds thirty seconds, and reaches
 * outside the tenant: "search just in case" would become the default on
 * questions the database already answers perfectly.
 *
 * So the tool is not merely discouraged for CRM questions — it is ABSENT from
 * the set the model is given. A capability the model cannot see is one it cannot
 * over-use, which is the same reasoning that keeps `agencyId` in a closure
 * instead of in a tool schema.
 *
 * IT FAILS CLOSED, AND THAT ASYMMETRY IS THE DESIGN. A missed research question
 * behaves exactly like the agent behaved yesterday — it answers from CRM
 * evidence and says plainly when it cannot determine something, which is a
 * proven, honest outcome. A false admission spends the rep's wall clock and the
 * agency's money to answer a CRM question worse. Precision therefore beats
 * recall, and the markers below are deliberately narrow.
 *
 * IT IS A HEURISTIC, AND IT IS NAMED AS ONE. A learned or model-based router is
 * a later phase; it would add a classification call to EVERY question, including
 * the CRM ones whose 15.8s average this phase must not regress. This costs
 * nothing, runs in microseconds, and is completely testable — and when it is
 * wrong it is wrong in the safe direction.
 */

/**
 * Words that mean the answer is OUTSIDE this business.
 *
 * Each one names the world rather than the customer's own rows: a market, an
 * industry, the internet, someone else's price. Words that a rep would equally
 * use about their own data are excluded on purpose — "מחיר" alone is a question
 * about their own quote, "לקוחות" is their own book, and admitting either would
 * send ordinary CRM questions to the web.
 */
const EXTERNAL_MARKERS: readonly string[] = [
  // Hebrew — the market and the world outside the business
  'מתחר', // מתחרים / מתחרה / המתחרים
  'שוק', // שוק / בשוק / השוק
  'מגמ', // מגמה / מגמות
  'תעשיי', // תעשייה
  'ענף',
  'חדשות',
  'באינטרנט',
  'ברשת',
  'תחקיר',
  'מחקר שוק',
  'סקר שוק',
  'בענף',
  // Explicit instructions to look something up
  'חפש לי',
  'תחפש',
  'תבדוק באינטרנט',
  'מה כתוב על',
  // English equivalents, for a mixed-language question
  'competitor',
  'market',
  'industry',
  'trend',
  'benchmark',
  'search the web',
  'look up',
  'latest news',
]

/**
 * Phrases that look external but are about THIS business's own records.
 *
 * "השוק שלי" in a rep's mouth is usually their own pipeline, and "מגמה" appears
 * in ordinary questions about their own activity — which `get_activity_trends`
 * already answers from real data. A veto here is cheaper than a wasted search
 * and much cheaper than a worse-grounded answer.
 */
const INTERNAL_OVERRIDES: readonly string[] = ['מגמות שלי', 'המגמות שלי', 'מגמה שלי', 'השוק שלי', 'my trends']

export type ResearchAdmission = {
  admitted: boolean
  /** The marker that admitted it, for the trace. Never the question text. */
  marker: string | null
}

/**
 * Decide, from the rep's own words only.
 *
 * NEVER from tool output, and never from conversation history the model
 * produced. A page that says "you should search the web for X" must not be able
 * to turn the next turn into a research run — admission reads the same narrow
 * input the action-intent derivation does, and for the same reason.
 */
export function admitsResearch(question: string | null | undefined): ResearchAdmission {
  const q = (question ?? '').toLowerCase()
  if (!q.trim()) return { admitted: false, marker: null }

  for (const veto of INTERNAL_OVERRIDES) {
    if (q.includes(veto.toLowerCase())) return { admitted: false, marker: null }
  }
  for (const marker of EXTERNAL_MARKERS) {
    if (q.includes(marker.toLowerCase())) return { admitted: true, marker }
  }
  return { admitted: false, marker: null }
}

/**
 * Wall clock for a research run.
 *
 * BOUNDED BY THE PLATFORM, NOT BY THE SLOWEST SEARCH. It was 90s, chosen to
 * clear a measured 72.9s two-company comparison (33.8s for one topic; see
 * `harvest.ts`) — but the route that runs it has `maxDuration = 60`, so a
 * research run past 60s was not given more time: the platform killed it, the
 * stream ended with no answer, and an action mid-execution was left for
 * reconciliation.
 *
 * 45s fits inside REQUEST_DEADLINE_MS (50s) with 5s left for any proposed
 * action, and FINALIZE_RESERVE_MS after that to close the stream. It clears
 * the measured single-topic search; the slowest multi-company comparison now
 * ends as a clean `deadline` answer the rep can narrow, instead of a silent
 * kill. Raising it requires raising `maxDuration` first — deadline.test.ts
 * fails otherwise.
 *
 * THE CRM DEADLINE IS UNCHANGED at 40s.
 */
export const RESEARCH_DEADLINE_MS = 45_000
