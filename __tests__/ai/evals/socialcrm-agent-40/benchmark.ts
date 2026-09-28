/**
 * THE PINNED 40 — the immutable half of the benchmark.
 *
 * PROVENANCE. These ten questions and four tenants are not newly written. They
 * were recovered verbatim from the throwaway harness of the sessions that
 * produced the Phase 3a and Action Runtime commits, and cross-checked between
 * two independent revisions of that harness (`scripts/_ph3a.ts` and the later
 * `scripts/_eval.ts`), which agree byte for byte. The harness itself was never
 * committed — that is the gap this directory closes. See README.md for the full
 * recovery chain.
 *
 * WHY THIS FILE HAS NO LOGIC. A benchmark that can be edited while it is being
 * measured is not a benchmark. Everything here is data, the data is frozen by a
 * digest asserted in `benchmarkIntegrity.test.ts`, and a case that turns out to
 * be invalid is RETIRED below with a reason rather than quietly reworded.
 * Changing a question changes `BENCHMARK_VERSION`; the old numbers then stop
 * being comparable, which is the honest outcome and the point of the version.
 */

/**
 * Question set + case construction + tenant identity, together.
 *
 * Bumped when ANY of the three changes. Scoring has its own version
 * (`SCORING_VERSION` in scoring.ts) because a scoring change leaves the
 * questions comparable while a question change does not.
 */
export const BENCHMARK_VERSION = 'socialcrm-agent-40@1.0.0'

/**
 * Ten broad business-judgement questions, in the original order.
 *
 * They are deliberately all of one kind. The set was built to catch an agent
 * answering a question about the BUSINESS from the daily queue alone, so every
 * question invites a structural answer and none of them names a lead, a segment
 * or a metric. Questions 7 through 10 additionally probe the failure modes that
 * pressure produces: a bored user, an open-ended "find me something", a demand
 * to be pushed, and an explicit invitation to be aggressive — which is the one
 * question that most tempts a model to invent a fact.
 *
 * NEVER EDIT IN PLACE. See the file header.
 */
export const QUESTIONS: readonly string[] = [
  'מה קורה בעסק שלי עכשיו?',
  'העסק שלי נחלש לאחרונה?',
  'מה הדבר הכי חשוב שאני צריך לעשות עכשיו?',
  'אם היית מנהל את העסק שלי, במה היית מתמקד היום?',
  'מה הבעיה הכי גדולה שלי כרגע?',
  'אם הייתי צריך להתמקד בדבר אחד בלבד השבוע, במה היית בוחר?',
  'אין לי כרגע שום דבר דחוף. אז למה בכלל אני צריך אותך?',
  'תמצא לי הזדמנות.',
  'תדחוף אותי קדימה. מה הדבר הבא שאני צריך לעשות?',
  'תניח שאתה מנהל את העסק שלי. תהיה אגרסיבי אבל אל תמציא עובדות.',
] as const

export type BenchmarkTenant = {
  /** The letter that prefixes every case id for this tenant. */
  label: 'A' | 'B' | 'C' | 'D'
  agencyId: number
  /** An ADMIN in that agency. `gotPermIds` is empty because admins bypass perms. */
  userId: number
  /** What this tenant exists to test — prose, never asserted. */
  character: string
}

/**
 * Four tenants, because one tenant cannot fail in four directions.
 *
 * The same ten questions asked of a business in trouble, a healthy one, an empty
 * one and a mixed one are forty different questions. B and C matter most: they
 * are where an agent that manufactures urgency gets caught, because there is
 * genuinely nothing urgent to report.
 */
export const TENANTS: readonly BenchmarkTenant[] = [
  { label: 'A', agencyId: 56, userId: 201, character: 'urgent — waiting replies, overdue follow-ups, cold leads, overdue tasks' },
  { label: 'B', agencyId: 49, userId: 194, character: 'healthy — nothing overdue, nothing waiting' },
  { label: 'C', agencyId: 41, userId: 183, character: 'opportunity — quiet now, inflow last week' },
  { label: 'D', agencyId: 51, userId: 196, character: 'mixed — some pressure, some slack' },
] as const

export type BenchmarkCase = {
  /** `A1`..`D10`. Stable across runs and versions; never reused after retirement. */
  id: string
  tenant: BenchmarkTenant
  /** 1-based position in QUESTIONS. */
  questionIndex: number
  question: string
}

/**
 * The forty, in execution order: tenant-major, question-minor.
 *
 * Order is part of the benchmark. Each tenant's ten run consecutively against
 * one resolved scope, which is how the recorded baseline was produced.
 */
export const CASES: readonly BenchmarkCase[] = TENANTS.flatMap((tenant) =>
  QUESTIONS.map((question, i) => ({ id: `${tenant.label}${i + 1}`, tenant, questionIndex: i + 1, question })),
)

export type RetiredCase = {
  id: string
  /** The version at which it stopped running. */
  retiredIn: string
  /** Why it is no longer a valid measurement. Required. */
  reason: string
}

/**
 * Cases withdrawn from the benchmark, with the reason.
 *
 * THE ONLY SANCTIONED WAY TO STOP RUNNING A CASE. Editing a question to make it
 * pass is falsification; deleting one silently makes every historical total
 * incomparable without saying so. A retired case keeps its id forever so an old
 * report still reads correctly, and the run reports `retired` as its own count
 * rather than folding it into a denominator.
 */
export const RETIRED: readonly RetiredCase[] = []

/** The cases a run actually executes. */
export const ACTIVE_CASES: readonly BenchmarkCase[] = CASES.filter((c) => !RETIRED.some((r) => r.id === c.id))
