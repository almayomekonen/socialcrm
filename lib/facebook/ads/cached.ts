import { readSnapshot, writeSnapshot, type SnapshotKind } from '@/db/adsSnapshots'
import type { AdsFailure, AdsResult } from '@/lib/facebook/ads/insights'

/**
 * Read-through cache for Meta answers (meta_ads_snapshots).
 *
 *  · fresh snapshot (younger than `ttlMs`)  → served, no Graph call;
 *  · otherwise Meta is asked, and a success replaces the snapshot;
 *  · a TRANSIENT failure (rate limit, Meta error/outage) with a snapshot no
 *    older than STALE_MAX_MS → the snapshot is served, flagged `stale` with its
 *    age, so the report still opens and says how old it is;
 *  · an AUTH or PERMISSION failure is never papered over: access may have been
 *    revoked, so nothing cached is shown for it.
 *
 * The caller must have verified the account for THIS connection before calling
 * (the page does, against `/me/adaccounts`). A cache problem never fails the
 * request — it only costs a Graph call.
 */

export const STALE_MAX_MS = 7 * 24 * 60 * 60 * 1000
const TRANSIENT: ReadonlySet<AdsFailure> = new Set(['rate_limited', 'meta_error'])

export type Cached<T> = { value: T; fetchedAt: string; stale: boolean }

export async function cachedAdsRead<T>(
  scope: { agencyId: number; accountId: string; kind: SnapshotKind },
  key: string,
  ttlMs: number,
  fetcher: () => Promise<AdsResult<T>>,
  now: Date = new Date(),
): Promise<AdsResult<Cached<T>>> {
  const snapshot = await readSnapshot<T>(scope, key).catch(() => null)
  const age = snapshot ? now.getTime() - snapshot.fetchedAt.getTime() : Infinity
  if (snapshot && age >= 0 && age < ttlMs) {
    return { ok: true, value: { value: snapshot.payload, fetchedAt: snapshot.fetchedAt.toISOString(), stale: false } }
  }

  const fresh = await fetcher()
  if ('value' in fresh) {
    await writeSnapshot(scope, key, fresh.value, now).catch((err) =>
      console.warn('[AdsReporting] snapshot not stored:', err instanceof Error ? err.message : 'unknown'),
    )
    return { ok: true, value: { value: fresh.value, fetchedAt: now.toISOString(), stale: false } }
  }
  if (snapshot && TRANSIENT.has(fresh.reason) && age < STALE_MAX_MS) {
    return { ok: true, value: { value: snapshot.payload, fetchedAt: snapshot.fetchedAt.toISOString(), stale: true } }
  }
  return { ok: false, reason: fresh.reason }
}

/** How long each kind of answer stays fresh. "Today" moves; finished days barely do. */
export function reportTtlMs(rangeKey: string): number {
  return rangeKey.startsWith('today') ? 10 * 60 * 1000 : 30 * 60 * 1000
}
/** Creative CDN URLs are signed and expire; refresh well within that. */
export const CREATIVE_TTL_MS = 2 * 24 * 60 * 60 * 1000
