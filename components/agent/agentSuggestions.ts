/**
 * The four openers offered on the empty state.
 *
 * These are REAL questions, not samples: each one maps onto capabilities the
 * agent actually has — the prioritised queue, the waiting-for-reply segment, the
 * conversation reader, and the business summary. That matters more here than it
 * looks. An empty state that offers a question the agent then cannot answer
 * teaches the rep, in their first ten seconds, that this surface over-promises.
 *
 * Kept as plain data in their own module so the intro does not import from
 * anything that could carry sample content.
 */
export const AGENT_SUGGESTIONS = [
  'מה דורש ממני טיפול היום?',
  'הצג לידים שלא קיבלו מענה',
  'סכם לי את השיחות האחרונות',
  'מה פספסתי היום?',
] as const
