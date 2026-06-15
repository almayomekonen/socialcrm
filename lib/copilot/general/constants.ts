/** Days since last interaction at/after which a lead is "not contacted recently". */
export const STALE_DAYS = 7

/** Min classifier confidence to answer in-set; below this we show the menu. */
export const GENERAL_HIGH_CONFIDENCE = 0.9

/**
 * HARD LIMIT — the maximum number of rows ANY General-Mode list reader returns.
 * Bounds query cost and payload size on every briefing/Q&A path. Readers still
 * report a TRUE total (via a `COUNT(*) OVER()` window evaluated before the
 * limit), so a capped sample never under-reports the headline number.
 */
export const BRIEFING_SAMPLE_LIMIT = 50

/**
 * Postgres expression for the start of the current week, Sunday 00:00 local.
 * EXTRACT(DOW) returns 0 for Sunday, so subtracting DOW days lands on Sunday.
 */
export const WEEK_START_SQL = `(date_trunc('day', NOW()) - make_interval(days => EXTRACT(DOW FROM NOW())::int))`
