import { db } from '@/config/db'
import type { PresenceRow } from '@/lib/notifications/presence'

/**
 * user_presence data access.
 *
 * Spec §7.2 names the notification feed poll as presence's single WRITER, and
 * frontend-experience-guidelines §14 requires one owner per live signal. There is
 * deliberately no heartbeat endpoint, no second loop, and no other module that
 * writes here: if presence had two writers, "when did this user last look at the
 * app" would have two answers.
 *
 * The notification worker (P3.0) is a READER only — one batched SELECT per pass
 * so channel routing can use the same classification the feed already stamps.
 * It never calls stampPresence / clearAwayBoundary.
 *
 * NOT users_info, by design (migration 20260811120006 header): recordLoginActivity
 * holds SELECT … FOR UPDATE on users_info during login, and a 30-second-cadence
 * write on that row would contend with it and risk clobbering login history.
 *
 * TENANT SCOPING: every statement carries BOTH "userId" and "agencyId", even
 * though "userId" alone is the primary key. The agency predicate is not
 * redundant defence — it is what makes a stale session whose agency changed
 * unable to read or move another tenant's presence row.
 */

/**
 * Minimum gap between presence writes, enforced in SQL (§stampPresence).
 *
 * Spec §7.2 says "at most once per 30s per user". At the feed's focused 3.5–5s
 * cadence that collapses roughly seven polls into one UPDATE. It is a WRITE
 * budget, not a presence-accuracy figure: the ONLINE window is 90s
 * (lib/notifications/presence.ts), so a 30s write cadence still leaves two
 * writes of headroom before a genuinely-present user could be misread as idle.
 */
export const PRESENCE_WRITE_THROTTLE_SECONDS = 30

/**
 * How long a user must be gone before returning counts as "away" — the gate on
 * "While you were away" appearing at all.
 *
 * Spec §13.3. Deliberately far longer than the IDLE window (10min): idle means
 * "at the desk, not looking", which needs no catch-up summary. Fifteen minutes
 * means they actually left. A lunch break qualifies; switching tabs does not.
 */
export const AWAY_GAP_MINUTES = 15

export type PresenceSnapshot = {
  /** null ⇒ no row at all ⇒ OFFLINE (spec §7.2). */
  lastSeenAt: Date | null
  lastSeenVisible: boolean
  /** The persisted "While you were away" boundary. null ⇒ no open away window. */
  awaySinceAt: Date | null
}

const EMPTY: PresenceSnapshot = { lastSeenAt: null, lastSeenVisible: false, awaySinceAt: null }

export function readPresenceQuery(args: { userId: number; agencyId: number }) {
  return db('user_presence')
    .where({ userId: args.userId, agencyId: args.agencyId })
    .first('lastSeenAt', 'lastSeenVisible', 'awaySinceAt')
}

/**
 * Read BEFORE stamping. The ordering is load-bearing, not stylistic: the stamp
 * overwrites lastSeenAt, so a read afterwards would always report the user as
 * having just been here and the away boundary could never be detected.
 */
export async function readPresence(args: { userId: number; agencyId: number }): Promise<PresenceSnapshot> {
  const row = await readPresenceQuery(args)
  if (!row) return EMPTY
  return {
    lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt) : null,
    lastSeenVisible: !!row.lastSeenVisible,
    awaySinceAt: row.awaySinceAt ? new Date(row.awaySinceAt) : null,
  }
}

/**
 * THE AWAY-BOUNDARY RULE — pure, so it is testable without a database or a clock.
 *
 * Returns the timestamp "While you were away" should measure from, or null when
 * there is no away window to show.
 *
 * Three cases, in order:
 *   1. An already-open boundary WINS. This is the invariant that keeps WYWA on
 *      screen: once opened, the boundary is not recomputed from a lastSeenAt that
 *      this very request is about to refresh. Without this, the section would
 *      render once and vanish on the next poll five seconds later.
 *   2. No previous row ⇒ null. A user's first ever visit has no away period; the
 *      alternative would greet brand-new users with a catch-up summary of
 *      notifications that predate them.
 *   3. Otherwise open a boundary at the previous lastSeenAt, but only if the gap
 *      exceeded AWAY_GAP_MINUTES.
 */
export function resolveAwayBoundary(args: { snapshot: PresenceSnapshot; now: Date }): Date | null {
  const { snapshot, now } = args
  if (snapshot.awaySinceAt) return snapshot.awaySinceAt
  if (!snapshot.lastSeenAt) return null

  const gapMs = now.getTime() - snapshot.lastSeenAt.getTime()
  if (gapMs < AWAY_GAP_MINUTES * 60_000) return null
  return snapshot.lastSeenAt
}

export type StampPresenceArgs = {
  userId: number
  agencyId: number
  /** The tab reported itself visible on this poll. Drives ONLINE vs IDLE. */
  visible: boolean
  /** From resolveAwayBoundary(). Persisted only if no boundary is already open. */
  awaySinceAt: Date | null
}

/**
 * PRESENCE STAMP — one statement, throttled by the database itself.
 *
 * The throttle is the `ON CONFLICT … WHERE` clause, not an application-side
 * "read then decide". That distinction matters with several tabs open: two
 * concurrent polls both see a stale lastSeenAt, both issue this statement, and
 * exactly one performs a write because the second no longer satisfies the
 * predicate. An if-statement in JavaScript would let both through.
 *
 * A VISIBILITY CHANGE BYPASSES THE THROTTLE (the IS DISTINCT FROM arm). A tab
 * going hidden is precisely the ONLINE → IDLE transition, and suppressing that
 * write for up to 30s would keep a user classified as watching the screen after
 * they switched away — which in P3 is the difference between a toast nobody sees
 * and a push that arrives correctly.
 *
 * awaySinceAt uses COALESCE so an OPEN boundary is never clobbered. Combined
 * with rule 1 of resolveAwayBoundary, the boundary has exactly one opener and
 * one closer, and neither can race the other into a half-state.
 */
export function stampPresenceQuery(args: StampPresenceArgs) {
  return db.raw(
    `
    INSERT INTO user_presence ("userId", "agencyId", "lastSeenAt", "lastSeenVisible", "awaySinceAt", "updatedAt")
    VALUES (:userId, :agencyId, now(), :visible, :awaySinceAt, now())
    ON CONFLICT ("userId") DO UPDATE
       SET "lastSeenAt"      = now(),
           "lastSeenVisible" = EXCLUDED."lastSeenVisible",
           "agencyId"        = EXCLUDED."agencyId",
           "awaySinceAt"     = COALESCE(user_presence."awaySinceAt", EXCLUDED."awaySinceAt"),
           "updatedAt"       = now()
     WHERE user_presence."agencyId" = :agencyId
       AND (user_presence."lastSeenAt" < now() - (:throttleSeconds * interval '1 second')
            OR user_presence."lastSeenVisible" IS DISTINCT FROM EXCLUDED."lastSeenVisible")`,
    {
      userId: args.userId,
      agencyId: args.agencyId,
      visible: args.visible,
      awaySinceAt: args.awaySinceAt ?? null,
      throttleSeconds: PRESENCE_WRITE_THROTTLE_SECONDS,
    },
  )
}

export async function stampPresence(args: StampPresenceArgs): Promise<void> {
  await stampPresenceQuery(args)
}

/**
 * Close the away window once it has nothing left to show.
 *
 * Called ONLY on the transition — when a boundary is open and the window yields
 * no unseen rows. The `awaySinceAt IS NOT NULL` predicate makes it idempotent, so
 * a repeat call writes zero rows rather than dirtying the page on every poll.
 */
export function clearAwayBoundaryQuery(args: { userId: number; agencyId: number }) {
  return db('user_presence')
    .where({ userId: args.userId, agencyId: args.agencyId })
    .whereNotNull('awaySinceAt')
    .update({ awaySinceAt: null, updatedAt: db.fn.now() })
}

export async function clearAwayBoundary(args: { userId: number; agencyId: number }): Promise<void> {
  await clearAwayBoundaryQuery(args)
}

/** Adapts a snapshot to the classifier's input. Absent/empty lastSeenAt ⇒ null ⇒ OFFLINE. */
export function toPresenceRow(snapshot: PresenceSnapshot): PresenceRow | null {
  if (!snapshot.lastSeenAt) return null
  return { lastSeenAt: snapshot.lastSeenAt, lastSeenVisible: snapshot.lastSeenVisible }
}

/**
 * Batched presence READ for the notification worker (P3.0) — one SELECT per pass.
 *
 * Spec §21.2: never a query per notification. The pairs are the potential
 * recipients already resolved for the pass (handlers + admins); a missing pair
 * simply yields no row and classifies OFFLINE, which is the fail-safe.
 *
 * SELECT only. The feed poll remains the sole writer of this table.
 */
export function loadPresenceBatchQuery(pairs: { agencyId: number; userId: number }[]) {
  if (pairs.length === 0) {
    return db.raw(`SELECT "userId", "agencyId", "lastSeenAt", "lastSeenVisible" FROM user_presence WHERE false`)
  }
  const tuples = pairs.map(() => '(?,?)').join(',')
  const bindings = pairs.flatMap((p) => [p.agencyId, p.userId])
  return db.raw(
    `SELECT "userId", "agencyId", "lastSeenAt", "lastSeenVisible"
       FROM user_presence
      WHERE ("agencyId", "userId") IN (${tuples})`,
    bindings,
  )
}

export async function loadPresenceBatch(
  pairs: { agencyId: number; userId: number }[],
): Promise<Map<number, PresenceRow>> {
  const out = new Map<number, PresenceRow>()
  if (pairs.length === 0) return out
  const res = await loadPresenceBatchQuery(pairs)
  for (const r of res.rows ?? []) {
    const userId = Number(r.userId)
    if (!Number.isFinite(userId)) continue
    // A row with a null lastSeenAt is treated as absent — same as no row.
    if (r.lastSeenAt == null) continue
    out.set(userId, {
      lastSeenAt: new Date(r.lastSeenAt as string | Date),
      lastSeenVisible: !!r.lastSeenVisible,
    })
  }
  return out
}
