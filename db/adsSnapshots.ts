import { db } from '@/config/db'

/**
 * meta_ads_snapshots — Meta's answers, cached per (agency, account, kind, key).
 * Every read and write names the agency; payloads hold Meta's numbers and
 * names, never a token. See migrations/20261006000001_meta_ads_intelligence.cjs.
 */

export type SnapshotKind = 'report' | 'breakdown' | 'top_ads' | 'creative' | 'account'

export type Snapshot<T> = { payload: T; fetchedAt: Date }

type Scope = { agencyId: number; accountId: string; kind: SnapshotKind }

const validScope = (s: Scope) => Number.isInteger(s.agencyId) && s.agencyId > 0 && /^act_\d+$/.test(s.accountId)

export async function readSnapshot<T>(scope: Scope, key: string): Promise<Snapshot<T> | null> {
  if (!validScope(scope)) return null
  const row = await db('meta_ads_snapshots')
    .where({ agencyId: scope.agencyId, accountId: scope.accountId, kind: scope.kind, key })
    .first('payload', 'fetchedAt')
  return row ? { payload: row.payload as T, fetchedAt: new Date(row.fetchedAt) } : null
}

export async function readSnapshots<T>(scope: Scope, keys: string[]): Promise<Map<string, Snapshot<T>>> {
  const out = new Map<string, Snapshot<T>>()
  if (!validScope(scope) || keys.length === 0) return out
  const rows = await db('meta_ads_snapshots')
    .where({ agencyId: scope.agencyId, accountId: scope.accountId, kind: scope.kind })
    .whereIn('key', keys)
    .select('key', 'payload', 'fetchedAt')
  for (const r of rows) out.set(r.key, { payload: r.payload as T, fetchedAt: new Date(r.fetchedAt) })
  return out
}

export async function writeSnapshot(scope: Scope, key: string, payload: unknown, fetchedAt = new Date()): Promise<void> {
  if (!validScope(scope)) return
  await db('meta_ads_snapshots')
    .insert({
      agencyId: scope.agencyId,
      accountId: scope.accountId,
      kind: scope.kind,
      key,
      payload: JSON.stringify(payload),
      fetchedAt,
    })
    .onConflict(['agencyId', 'accountId', 'kind', 'key'])
    .merge({ payload: JSON.stringify(payload), fetchedAt })
}

/** The newest creative snapshot for an ad in ANY of this agency's accounts — for the lead page. */
export async function readCreativeForAd<T>(agencyId: number, adId: string): Promise<Snapshot<T> | null> {
  if (!Number.isInteger(agencyId) || agencyId <= 0 || !/^\d{1,32}$/.test(adId)) return null
  const row = await db('meta_ads_snapshots')
    .where({ agencyId, kind: 'creative', key: adId })
    .orderBy('fetchedAt', 'desc')
    .first('payload', 'fetchedAt')
  return row ? { payload: row.payload as T, fetchedAt: new Date(row.fetchedAt) } : null
}
