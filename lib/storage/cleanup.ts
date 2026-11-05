import 'server-only'
import type { Knex } from 'knex'
import { db } from '@/config/db'
import { logStorageEvent } from './events'
import { isStorageKey } from './keys'
import { deleteObject } from './objects'

/**
 * Removing an object after its row is gone.
 *
 * `files` rows disappear by cascade when a lead or task is deleted, so callers read the
 * paths BEFORE deleting, inside the transaction, and call this only AFTER it commits: a
 * rollback must never have cost a file.
 *
 * BEST EFFORT, BY DESIGN. The business delete has already happened and must not fail
 * because of storage. A failure is counted and logged, and scripts/r2-orphan-report.ts
 * finds what was left behind.
 *
 * An object survives while any row still points at it (a task created from a template
 * shares its template's object). Legacy paths are skipped without contacting R2.
 */

const CONCURRENCY = 5

type Query = Knex | Knex.Transaction

export async function filePathsForLeads(q: Query, agencyId: number, leadIds: number[]): Promise<string[]> {
  if (leadIds.length === 0) return []
  // By `clientId` only: that is what cascades. A row with only a `taskId` outlives the lead,
  // since `tasks` has no foreign key to `clients`, so its object must stay too.
  const rows = await q('files').where({ agencyId }).whereIn('clientId', leadIds).select('path')
  return rows.map((r: { path: string | null }) => r.path).filter(isStorageKey)
}

export async function filePathsForTask(q: Query, agencyId: number, taskId: number): Promise<string[]> {
  const rows = await q('files').where({ agencyId, taskId }).select('path')
  return rows.map((r: { path: string | null }) => r.path).filter(isStorageKey)
}

export async function removeUnreferencedObjects(agencyId: number, paths: readonly unknown[]): Promise<void> {
  const keys = [...new Set(paths.filter(isStorageKey))]
  if (keys.length === 0) return

  let removed = 0
  let failed = 0
  try {
    const stillUsed = new Set(
      (await db('files').where({ agencyId }).whereIn('path', keys).select('path')).map((r: { path: string }) => r.path),
    )
    const queue = keys.filter((k) => !stillUsed.has(k))
    const worker = async () => {
      for (let key = queue.pop(); key; key = queue.pop()) {
        try {
          await deleteObject(key)
          removed += 1
        } catch {
          // The adapter logged the cause.
          failed += 1
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  } catch (err) {
    logStorageEvent('object.delete_failed', { agencyId, code: (err as Error)?.name ?? null, count: keys.length })
    return
  }
  if (removed) logStorageEvent('object.deleted', { agencyId, count: removed })
  if (failed) logStorageEvent('object.delete_failed', { agencyId, count: failed })
}
