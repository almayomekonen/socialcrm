/**
 * Which stored objects no row points at. Pure.
 *
 * Objects can outlive their rows: a batch upload where a later file fails before
 * registration, a browser closed mid-upload, or a delete R2 refused. Young objects are
 * ignored, because an upload in progress has no row yet.
 */

export const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000

export type StoredObject = { key: string; size: number; lastModified: Date }

export function findOrphans(objects: readonly StoredObject[], referenced: ReadonlySet<string>, nowMs: number): StoredObject[] {
  return objects.filter((o) => !referenced.has(o.key) && nowMs - o.lastModified.getTime() >= ORPHAN_MIN_AGE_MS)
}
